/** Responsive photo from public/images: name-<width>.webp with a jpg fallback. */
const B = import.meta.env.BASE_URL

export function Img({ name, alt, sizes, widths = [700, 1200, 2000] }: { name: string; alt: string; sizes: string; widths?: number[] }) {
  const src = (w: number, ext: string) => `${B}images/${name}-${w}.${ext} ${w}w`
  const fallback = widths.includes(1200) ? 1200 : widths[widths.length - 1]
  return (
    <picture>
      <source type="image/webp" srcSet={widths.map((w) => src(w, 'webp')).join(', ')} sizes={sizes} />
      <img src={`${B}images/${name}-${fallback}.jpg`}srcSet={widths.map((w) => src(w, 'jpg')).join(', ')} sizes={sizes} alt={alt} loading="lazy" decoding="async" />
    </picture>
  )
}
