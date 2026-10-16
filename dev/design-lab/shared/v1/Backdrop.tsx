import { TRACKS } from './fixtures';

// dev/design-lab/shared/v1/Backdrop.tsx：浮层模板的固定背景，非真实海报墙引擎。
export function Backdrop({ selected = 0 }: { selected?: number }) {
    return <div className="demo-backdrop" aria-hidden="true"><div className="backdrop-brand">Folia <span>留在音乐里</span></div><div className="backdrop-grid">{TRACKS.slice(0, 6).map((song, index) => <div key={song.id} data-selected={index === selected}><img src={song.cover} alt="" /><span>{song.title}</span></div>)}</div></div>;
}
