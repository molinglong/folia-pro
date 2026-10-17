import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

// test/unit/videoExport/mp4DurationPatch.test.ts
// MediaRecorder's fragmented MP4 header carries no runtime, so the export hook measures the
// seconds and the main process stamps them into mvhd. These fixtures mimic that header shape.

const require = createRequire(import.meta.url);
const { patchMp4Duration } = require('../../../electron/videoExport/mp4DurationPatch.cjs') as {
    patchMp4Duration: (buffer: Buffer, seconds: number) => boolean;
};

const buildBox = (type: string, payload: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, payload]);
};

const buildMvhd = (version: 0 | 1, timescale: number, duration: number | bigint) => {
    const payload = Buffer.alloc(version === 1 ? 100 : 90);
    payload[0] = version;
    if (version === 1) {
        payload.writeUInt32BE(timescale, 20);
        payload.writeBigUInt64BE(BigInt(duration), 24);
    } else {
        payload.writeUInt32BE(timescale, 12);
        payload.writeUInt32BE(Number(duration), 16);
    }
    return buildBox('mvhd', payload);
};

const buildFile = (mvhd: Buffer) => Buffer.concat([
    buildBox('ftyp', Buffer.from('isomiso2avc1mp41', 'latin1')),
    buildBox('moov', Buffer.concat([mvhd, buildBox('trak', Buffer.alloc(16))])),
]);

describe('patchMp4Duration', () => {
    it('stamps the mvhd v0 duration from the measured seconds', () => {
        const buffer = buildFile(buildMvhd(0, 1000, 0));
        expect(patchMp4Duration(buffer, 12.5)).toBe(true);
        // locate mvhd by walking the box chain once more, from the patched output side
        const ftypSize = buffer.readUInt32BE(0);
        const mvhdAt = ftypSize + 8; // moov header, then first child
        expect(buffer.toString('latin1', mvhdAt + 4, mvhdAt + 8)).toBe('mvhd');
        expect(buffer.readUInt32BE(mvhdAt + 24)).toBe(12500);
    });

    it('stamps the 64-bit mvhd v1 duration', () => {
        const buffer = buildFile(buildMvhd(1, 1000, 0n));
        expect(patchMp4Duration(buffer, 45.25)).toBe(true);
        const ftypSize = buffer.readUInt32BE(0);
        const mvhdAt = ftypSize + 8;
        expect(buffer.readBigUInt64BE(mvhdAt + 32)).toBe(45250n);
    });

    it('refuses files without a moov box or with a corrupt box chain', () => {
        expect(patchMp4Duration(buildBox('ftyp', Buffer.alloc(12)), 10)).toBe(false);
        const broken = buildFile(buildMvhd(0, 1000, 0));
        broken.writeUInt32BE(0xFFFF_FFFF, 0); // ftyp claims a size past the end of the buffer
        expect(patchMp4Duration(broken, 10)).toBe(false);
    });

    it('refuses non-positive or non-finite runtimes', () => {
        const buffer = buildFile(buildMvhd(0, 1000, 0));
        expect(patchMp4Duration(buffer, 0)).toBe(false);
        expect(patchMp4Duration(buffer, Number.NaN)).toBe(false);
    });

    it('leaves an unknown mvhd version untouched', () => {
        const mvhd = buildMvhd(0, 1000, 0);
        mvhd[8] = 2; // version byte sits right after the box header
        expect(patchMp4Duration(buildFile(mvhd), 10)).toBe(false);
    });
});
