import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

/** Miniatury: oryginał i bieżąca maska. */
export function ImagePanel() {
  const source = useStore((s) => s.source);
  const mask = useStore((s) => s.mask);
  const status = useStore((s) => s.status);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !mask) return;
    c.width = mask.width;
    c.height = mask.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.data.length; i++) {
      const v = mask.data[i] ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [mask]);

  if (!source) return null;
  return (
    <div className="thumbs">
      <figure>
        <div className="thumb checker">
          <img src={source.url} alt="Oryginał" />
        </div>
        <figcaption>
          Oryginał · {source.width}×{source.height}
        </figcaption>
      </figure>
      <figure>
        <div className="thumb">{mask && <canvas ref={ref} />}</div>
        <figcaption>Maska {status === 'masking' ? '· liczę…' : mask ? `· ${mask.width}×${mask.height}` : ''}</figcaption>
      </figure>
    </div>
  );
}
