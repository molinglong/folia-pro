import { useEffect, useRef, useState } from 'react';
import type { SongResult } from '../../types';
import { getOnlineMusicProviderForSong } from './providerRegistry';

// src/services/onlineMusic/useCurrentSongMv.ts
// Resolves the current song's official MV stream for the video layer. MV URLs are temporary
// platform links, so the cache only smooths same-song remounts within the TTL and never
// outlives the session; every miss/failure collapses to null so the layer falls back silently.

const MV_URL_TTL_MS = 5 * 60 * 1000;

type CachedMvUrl = { url: string; fetchedAt: number };

const mvUrlCache = new Map<string, CachedMvUrl>();

const songKeyOf = (song: SongResult | null): string | null => {
    if (!song) return null;
    const ref = song.sourceRef;
    if (!ref || ref.kind !== 'online') return null;
    return `${ref.providerId}:${ref.mediaId}`;
};

export const useCurrentSongMvUrl = (song: SongResult | null): string | null => {
    const key = songKeyOf(song);
    const songRef = useRef(song);
    songRef.current = song;
    const cached = key ? mvUrlCache.get(key) : undefined;
    const [mvUrl, setMvUrl] = useState<string | null>(
        cached && Date.now() - cached.fetchedAt < MV_URL_TTL_MS ? cached.url : null,
    );

    useEffect(() => {
        if (!key) {
            setMvUrl(null);
            return;
        }
        const hit = mvUrlCache.get(key);
        if (hit && Date.now() - hit.fetchedAt < MV_URL_TTL_MS) {
            setMvUrl(hit.url);
            return;
        }
        // Latest song wins: a provider that resolves after the user moved on must not paint
        // its MV behind the wrong song (cleanup flag guards the async hop).
        let cancelled = false;
        const currentSong = songRef.current;
        const provider = currentSong ? getOnlineMusicProviderForSong(currentSong) : null;
        const run = async () => {
            try {
                if (!currentSong || !provider?.mv) {
                    setMvUrl(null);
                    return;
                }
                const source = await provider.mv.getMvUrl(currentSong);
                if (cancelled) return;
                if (source?.url) {
                    mvUrlCache.set(key, { url: source.url, fetchedAt: Date.now() });
                    setMvUrl(source.url);
                } else {
                    setMvUrl(null);
                }
            } catch (error) {
                if (cancelled) return;
                console.warn('[SongMv] mv lookup failed:', error);
                setMvUrl(null);
            }
        };
        void run();
        return () => { cancelled = true; };
    }, [key]);

    return mvUrl;
};
