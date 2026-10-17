import type { SongResult } from '../../types';
import type { OnlineProviderId, ProviderSongMetadata } from '../../types/onlineMusic';
import { normalizeLyricMatchText } from '../../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { getProviderSongMetadata } from './songMetadata';
import { listOnlineMusicProviders } from './providerRegistry';
import { hasQqSession } from './qqTransport';

// src/services/onlineMusic/crossPlatformReplacement.ts
// The cross-platform "same song, another platform" lookup that ties the three providers together:
// when a song is unplayable on its own platform (greyed out, or the provider hands back no stream),
// search the other logged-in platforms for the identical recording and replace it in the queue.
//
// Confidence is deliberately strict. This is the same song or nothing - a live/cover/instrumental
// version playing where the studio track was expected is worse than skipping. `exact` (equal
// normalized title + matching primary artist + duration within 8s) is what the auto-replace switch
// may act on; `near` (same identity, duration 8-20s apart) is offered for confirmation only.
// Anything weaker is not a candidate at all - we never guess a replacement from fuzzy titles.

export type CrossReplacementConfidence = 'exact' | 'near';

export interface CrossReplacementCandidate {
    providerId: OnlineProviderId;
    /** Provider display label for UI text (shortName, falling back to displayName). */
    providerLabel: string;
    song: SongResult;
    confidence: CrossReplacementConfidence;
    /** Absolute duration difference against the original song, in milliseconds. */
    durationDiffMs: number;
}

export interface CrossReplacementLookupOptions {
    /** Ask each candidate's provider for a real stream before offering it. Costs one extra request
     *  per surviving candidate but collapses "listed in the library" and "this account can play it"
     *  into one answer - VIP-only tracks on a non-VIP platform search fine and play empty. */
    validatePlayability?: boolean;
    signal?: AbortSignal;
}

const SEARCH_PAGE_SIZE = 12;
const EXACT_DURATION_TOLERANCE_MS = 8_000;
const NEAR_DURATION_TOLERANCE_MS = 20_000;
const PROVIDER_SEARCH_TIMEOUT_MS = 12_000;
const PLAYBACK_PROBE_TIMEOUT_MS = 8_000;
const CANDIDATE_CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 30 * 60 * 1000;
const CANDIDATE_CACHE_MAX = 100;

// Priority for same-confidence contenders. QQ first: widest library of the three. Account-level VIP
// is intentionally not a factor - QQ's upstream exposes no VIP field at all (probed while wiring
// account summaries), so a membership-first rule would silently privilege exactly one platform.
const PROVIDER_PRIORITY: OnlineProviderId[] = ['qq', 'kugou', 'netease'];

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`cross-replacement ${label} timed out`)), ms);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
};

const artistTokens = (metadata: ProviderSongMetadata): string[] => (
    metadata.artists
        .map(artist => normalizeLyricMatchText(artist.name))
        .filter(Boolean)
);

// Equal-or-contained, length-guarded both ways: a platform's romanized suffix on the same name
// still matches; containment only counts when the shorter token is at least two characters.
const tokenMatches = (left: string, right: string): boolean => {
    if (!left || !right) return false;
    if (left === right) return true;
    if (left.length >= 2 && right.includes(left)) return true;
    if (right.length >= 2 && left.includes(right)) return true;
    return false;
};

const primaryArtistMatches = (target: string[], candidate: string[]): boolean => (
    target.length > 0 && candidate.length > 0 && target.some(token => candidate.some(other => tokenMatches(token, other)))
);

const resolveProviderLabel = (providerId: OnlineProviderId): string => {
    const provider = listOnlineMusicProviders().find(entry => entry.id === providerId);
    return provider?.shortName || provider?.displayName || providerId;
};

const findProvider = (providerId: OnlineProviderId) => (
    listOnlineMusicProviders().find(entry => entry.id === providerId)
);

/** Providers worth asking, in priority order: registered, searchable, transport configured,
 *  logged in (or account-less, where there is nothing to log into), and not the platform the
 *  failed song already belongs to. */
const eligibleReplacementProviders = (selfProviderId: OnlineProviderId): OnlineProviderId[] => {
    const accounts = useOnlineProviderAccountStore.getState().accounts;
    const known = PROVIDER_PRIORITY.filter(id => id !== selfProviderId);
    const rest = listOnlineMusicProviders().map(provider => provider.id).filter(id => id !== selfProviderId && !known.includes(id));
    return [...known, ...rest].filter(id => {
        const provider = findProvider(id);
        if (!provider?.capabilities.search || !provider.search) return false;
        if (!provider.capabilities.auth) return true;
        if (provider.getAvailability?.().configured !== true) return false;
        // QQ's search and streams both need the backend session; an anonymous QQ cannot answer.
        if (id === 'qq' && !hasQqSession()) return false;
        const account = accounts[id];
        // cloudOrigin snapshots claim no real session; without a local one there is nothing to search with.
        return account?.status === 'authenticated' || Boolean(account?.user);
    });
};

interface ScoredCandidate {
    providerId: OnlineProviderId;
    song: SongResult;
    confidence: CrossReplacementConfidence;
    durationDiffMs: number;
}

interface ReplacementTarget {
    /** The display title lives on the song itself - ProviderSongMetadata carries artists/album/duration. */
    title: string;
    metadata: ProviderSongMetadata;
}

const scoreSongs = (target: ReplacementTarget, songs: SongResult[], selfProviderId: OnlineProviderId): ScoredCandidate[] => {
    const targetTitle = normalizeLyricMatchText(target.title || '');
    if (!targetTitle) return [];
    const targetArtists = artistTokens(target.metadata);
    const scored: ScoredCandidate[] = [];
    for (const song of songs) {
        const sourceRef = getPlaybackSourceRef(song);
        if (sourceRef.kind !== 'online' || sourceRef.providerId === selfProviderId) continue;
        const metadata = getProviderSongMetadata(song, sourceRef.providerId);
        const candidateTitle = normalizeLyricMatchText(song.name || '');
        // Exact identity only: normalized equality, or containment with at most a 4-character
        // display-suffix slack. Same-title different-version songs are separated by duration below.
        const titleEqual = candidateTitle !== '' && (
            candidateTitle === targetTitle
            || (candidateTitle.startsWith(targetTitle) && candidateTitle.length - targetTitle.length <= 4)
            || (targetTitle.startsWith(candidateTitle) && targetTitle.length - candidateTitle.length <= 4)
        );
        if (!titleEqual) continue;
        if (!primaryArtistMatches(targetArtists, artistTokens(metadata))) continue;
        const targetDurationMs = target.metadata.durationMs || 0;
        const candidateDurationMs = metadata.durationMs || 0;
        const durationDiffMs = Math.abs(candidateDurationMs - targetDurationMs);
        const hasDurations = targetDurationMs > 0 && candidateDurationMs > 0;
        if (hasDurations && durationDiffMs > NEAR_DURATION_TOLERANCE_MS) continue;
        const confidence: CrossReplacementConfidence = !hasDurations || durationDiffMs <= EXACT_DURATION_TOLERANCE_MS ? 'exact' : 'near';
        scored.push({
            providerId: sourceRef.providerId,
            song,
            confidence,
            durationDiffMs,
        });
    }
    return scored;
};

const probePlayability = async (candidate: ScoredCandidate, song: SongResult): Promise<boolean> => {
    const provider = findProvider(candidate.providerId);
    if (!provider?.playback?.getAudioSource) return true;
    try {
        // 'standard' on purpose: this asks "may this account stream this song at all", not "what
        // does the quality preference resolve to" - a VIP track answers the same at every tier.
        const source = await withTimeout(
            provider.playback.getAudioSource(song, 'standard'),
            PLAYBACK_PROBE_TIMEOUT_MS,
            'playback-probe',
        );
        return Boolean(source?.url);
    } catch {
        // Any probe failure (auth hiccup, risk control, timeout) means "cannot confirm", not
        // "confirmed dead": drop this candidate and keep the others, never the whole lookup.
        return false;
    }
};

type CacheEntry = { candidates: CrossReplacementCandidate[]; expiresAt: number };
const candidateCache = new Map<string, CacheEntry>();

const cacheKeyOf = (song: SongResult): string | null => {
    const sourceRef = getPlaybackSourceRef(song);
    return sourceRef.kind === 'online' ? `${sourceRef.providerId}:${sourceRef.mediaId}` : null;
};

const toCandidate = (scored: ScoredCandidate): CrossReplacementCandidate => ({
    providerId: scored.providerId,
    providerLabel: resolveProviderLabel(scored.providerId),
    song: scored.song,
    confidence: scored.confidence,
    durationDiffMs: scored.durationDiffMs,
});

/**
 * Searches the other logged-in platforms for the identical recording of `song`, best tier first.
 * Returns every surviving candidate (exact tier first, then near) so the caller can auto-replace,
 * confirm, or list alternatives; an empty array means "no source to switch to", which callers
 * surface as the ordinary unplayable path.
 */
export const findCrossPlatformCandidates = async (
    song: SongResult,
    options: CrossReplacementLookupOptions = {},
): Promise<CrossReplacementCandidate[]> => {
    const sourceRef = getPlaybackSourceRef(song);
    if (sourceRef.kind !== 'online') return [];
    const selfProviderId = sourceRef.providerId;
    const cacheKey = cacheKeyOf(song);

    if (cacheKey) {
        const hit = candidateCache.get(cacheKey);
        if (hit && hit.expiresAt >= Date.now()) {
            // Cached candidates went through the same playability gate on the way in; re-serving
            // them is what keeps the manual menu from re-firing three platform searches per click.
            return hit.candidates;
        }
    }

    const targetMetadata = getProviderSongMetadata(song, selfProviderId);
    const target: ReplacementTarget = { title: song.name || '', metadata: targetMetadata };
    const query = buildLyricSearchQuery(target.title, targetMetadata.artists.map(artist => artist.name).join(', '), targetMetadata.album?.name);
    if (!query.trim()) return [];

    const collected: ScoredCandidate[] = [];
    let sawExact = false;
    // Sequential in priority order, with a short-circuit: once the preferred platform has an exact
    // same-song match, asking the others only adds latency and risk-control exposure.
    for (const providerId of eligibleReplacementProviders(selfProviderId)) {
        if (sawExact || options.signal?.aborted) break;
        const provider = findProvider(providerId);
        try {
            const page = await withTimeout(
                provider!.search!.searchSongs(query, SEARCH_PAGE_SIZE, 0),
                PROVIDER_SEARCH_TIMEOUT_MS,
                `search:${providerId}`,
            );
            const scored = scoreSongs(target, page.items as SongResult[], selfProviderId);
            if (scored.some(candidate => candidate.confidence === 'exact')) sawExact = true;
            collected.push(...scored);
        } catch (error) {
            // A platform that is rate-limited, offline or otherwise refuses simply drops out.
            console.warn('[CrossReplacement] provider search failed', providerId, error instanceof Error ? error.message : error);
        }
    }

    let survivors = collected.sort((left, right) => (
        left.confidence === right.confidence
            ? left.durationDiffMs - right.durationDiffMs
            : (left.confidence === 'exact' ? -1 : 1)
    ));

    if (options.validatePlayability) {
        const probed: ScoredCandidate[] = [];
        for (const candidate of survivors) {
            if (options.signal?.aborted) break;
            if (await probePlayability(candidate, candidate.song)) probed.push(candidate);
        }
        survivors = probed;
    }

    const candidates = survivors.map(toCandidate);
    if (cacheKey) {
        if (candidateCache.size >= CANDIDATE_CACHE_MAX) candidateCache.clear();
        // "Nothing on any platform" is far more stable than "what the platforms answered"; give an
        // empty answer the longer life so a queue of grey songs does not re-search per track.
        candidateCache.set(cacheKey, {
            candidates,
            expiresAt: Date.now() + (candidates.length > 0 ? CANDIDATE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
        });
    }
    return candidates;
};

/** Drops cached candidate lists - call with no song after a global change (login/logout), or with
 *  the song after its own playability state changed. */
export const invalidateCrossReplacementCache = (song?: SongResult): void => {
    if (!song) {
        candidateCache.clear();
        return;
    }
    const key = cacheKeyOf(song);
    if (key) candidateCache.delete(key);
};
