// electron/videoExport/mp4DurationPatch.cjs
// Stamps a real duration into the mvhd box of a MediaRecorder fragmented-MP4 buffer.
//
// Chromium's MediaRecorder writes the moov header up front in streaming mode and never goes
// back to fill in mvhd.duration, so players and the Windows shell report the finished file as
// 0:00 even though it plays. The renderer knows exactly how many seconds it recorded, so we
// overwrite that one field in the buffer before it reaches the disk. Any surprise in the box
// layout aborts silently and the untouched file still plays - this is a cosmetic repair, not
// a hard dependency.
'use strict';

const MAX_SCAN_OFFSET = 4 * 1024 * 1024; // the streaming writer always puts moov in the first few KB

const findBox = (buf, start, end, type) => {
    let offset = start;
    while (offset + 8 <= end) {
        const size = buf.readUInt32BE(offset);
        if (size < 8 || offset + size > end) {
            return null; // truncated or corrupt box chain
        }
        if (buf.toString('latin1', offset + 4, offset + 8) === type) {
            return { offset, size };
        }
        offset += size;
    }
    return null;
};

/**
 * Patches buffer in place. Returns true when mvhd.duration was written.
 * @param {Buffer} buffer the complete recorded file
 * @param {number} seconds the actual recorded runtime in seconds
 */
const patchMp4Duration = (buffer, seconds) => {
    try {
        if (!Buffer.isBuffer(buffer) || !Number.isFinite(seconds) || seconds <= 0) {
            return false;
        }

        const moov = findBox(buffer, 0, Math.min(buffer.length, MAX_SCAN_OFFSET), 'moov');
        if (!moov) {
            return false;
        }

        const mvhd = findBox(buffer, moov.offset + 8, moov.offset + moov.size, 'mvhd');
        if (!mvhd || mvhd.size < 8 + 32) {
            return false;
        }

        const box = mvhd.offset;
        const version = buffer[box + 8];
        if (version === 1) {
            const timescale = buffer.readUInt32BE(box + 28);
            if (!timescale) {
                return false;
            }
            const duration = BigInt(Math.round(timescale * seconds));
            buffer.writeBigUInt64BE(duration, box + 32);
            return true;
        }
        if (version === 0) {
            const timescale = buffer.readUInt32BE(box + 20);
            if (!timescale) {
                return false;
            }
            const duration = Math.min(0xFFFFFFFF, Math.round(timescale * seconds));
            buffer.writeUInt32BE(duration, box + 24);
            return true;
        }
        return false; // unknown mvhd version - leave the file alone
    } catch {
        return false;
    }
};

module.exports = { patchMp4Duration };
