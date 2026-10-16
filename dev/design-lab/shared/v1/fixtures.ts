// dev/design-lab/shared/v1/fixtures.ts：冻结的原创样例与本地 SVG；新版本另建目录。
const palettes = [
    ['#dddcd4', '#687269', '#faf7ef'], ['#cbcbd5', '#575d73', '#f0e5d8'],
    ['#e4d1c0', '#aa7866', '#f6ead8'], ['#cbd6d2', '#547d79', '#e8e4d5'],
    ['#d7c5c5', '#895e65', '#f8ede1'], ['#dedccb', '#828669', '#f6f3ea'],
];
function artwork(index: number) {
    const [base, ink, light] = palettes[index % palettes.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="${base}"/><circle cx="${240 + index * 12}" cy="188" r="119" fill="${light}"/><path d="M-20 390 Q90 ${150 + index * 15} 255 312 T510 247 V490 H-20Z" fill="${ink}"/><path d="M-20 425 Q160 295 290 398 T510 356" fill="none" stroke="${light}" stroke-width="2" opacity=".5"/><text x="35" y="55" font-family="sans-serif" font-size="12" letter-spacing="5" fill="${ink}">FOLIA SESSIONS</text><text x="35" y="435" font-family="Georgia,serif" font-size="40" fill="${light}">${['Margin', 'Tides', 'Stillness', 'Letters', 'Afterglow', 'North'][index % 6]}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
export const TRACKS = [
    { id: 'margin', title: '风经过书页', artist: '林间来信', album: '留白', duration: '04:00', cover: artwork(0) },
    { id: 'tides', title: '潮汐之间', artist: '岸与海', album: '潮汐之间', duration: '03:46', cover: artwork(1) },
    { id: 'still', title: '慢慢的夜', artist: '许知遥', album: '安静练习', duration: '04:12', cover: artwork(2) },
    { id: 'letters', title: '雾中信', artist: '林间来信', album: '远山', duration: '03:28', cover: artwork(3) },
    { id: 'sunset', title: '日落之前', artist: '渡口乐队', album: '未完的夏天', duration: '04:35', cover: artwork(4) },
    { id: 'north', title: '北方的风', artist: '岸与海', album: '缓慢经过', duration: '03:59', cover: artwork(5) },
    { id: 'walk', title: '沿着河流散步', artist: '许知遥', album: '留在此刻', duration: '04:08', cover: artwork(0) },
    { id: 'light', title: '等一盏灯', artist: '渡口乐队', album: '回程', duration: '03:41', cover: artwork(3) },
] as const;
export const LYRICS = ['风经过书页，停在你的名字', '把平凡的片刻，轻轻写成诗', '我们沿着河流，慢慢走向明天', '天色还很温柔，故事还没有结束'];
export const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
export type DemoTrack = typeof TRACKS[number];
