import { useEffect, useRef } from 'react';

/** Draws one of the player's block images (an ImageBitmap) over its whole box, for the palette and the Gear grid. */
export function IconCanvas({ image, size, className }: { image: ImageBitmap; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, size, size);
  }, [image, size]);
  return <canvas ref={ref} width={size} height={size} aria-hidden="true" className={className} style={{ width: '100%', height: '100%' }} />;
}
