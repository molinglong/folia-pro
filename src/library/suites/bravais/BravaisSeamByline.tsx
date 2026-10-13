import React from 'react';
import type { BravaisSeamBylineData } from './bravaisSeamModels';

// src/library/suites/bravais/BravaisSeamByline.tsx
// @fork 本地魔改版：完整信息条里元数据行下面的署名行——专辑的艺人与发行信息（数据在 bravaisBylineProjection.ts 投影）。
// 只画文字与按钮，不查数据：艺人有 onOpen（suite 声明了 open-artist）才做成按钮，否则是同一档墨色的纯文本。
// 换层时整条缝会翻，这一块的随层生死，所以它不进 BravaisSeamFlipText（那个管的是同一层里文案换了）。

type BravaisSeamBylineProps = {
    byline: BravaisSeamBylineData;
};

const BravaisSeamByline: React.FC<BravaisSeamBylineProps> = ({ byline }) => (
    <div className="bravais-seam-byline" data-bravais-seam-byline>
        {byline.artists.length > 0 && (
            <div className="bravais-seam-byline-artists" data-bravais-seam-byline-artists>
                {byline.artists.map((artist, index) => (
                    artist.onOpen ? (
                        <button key={`${artist.name}-${index}`} type="button" data-bravais-seam-byline-artist onClick={artist.onOpen}>
                            {artist.name}
                        </button>
                    ) : (
                        <span key={`${artist.name}-${index}`}>{artist.name}</span>
                    )
                ))}
            </div>
        )}
        {byline.facts.map((fact, index) => (
            <div key={`${fact}-${index}`} className="bravais-seam-byline-fact" data-bravais-seam-byline-fact>{fact}</div>
        ))}
    </div>
);

export default BravaisSeamByline;
