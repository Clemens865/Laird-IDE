/**
 * Hidden SVG defs: the glass-distortion filter and the two board symbols,
 * ported verbatim (path data unchanged) from design/assets/surfboard-side-
 * outline.svg / surfboard-top-outline.svg via design/variations/v9-
 * signature/index.html. Mounted once near the app root; every BoardFlip
 * instance references these by id by `<use>`.
 */
export function BoardDefs() {
  return (
    <svg className="defs">
      <filter id="glassDistort">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves={2} seed={7} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={6} />
      </filter>
      <symbol id="board-side" viewBox="0 0 1200 420" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          vectorEffect="non-scaling-stroke"
          d="M 132 204 C 356 188 716 205 917 183 C 977 176 1016 160 1062 147 C 1071 145 1076 148 1068 156 C 1016 202 921 217 785 219 C 577 223 321 222 137 219 Q 123 218 123 211 Q 123 206 132 204 Z"
        />
        <path
          vectorEffect="non-scaling-stroke"
          d="M 262 220 C 278 250 263 279 235 307 C 233 310 235 312 240 310 C 296 292 331 259 342 221"
        />
      </symbol>
      <symbol id="board-top" viewBox="0 0 1200 420" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          vectorEffect="non-scaling-stroke"
          d="M 1071 210 C 979 142 846 103 681 95 C 463 82 276 114 143 169 Q 123 177 123 194 L 123 226 Q 123 243 143 251 C 276 306 463 338 681 325 C 846 317 979 278 1071 210 Z"
        />
        <path vectorEffect="non-scaling-stroke" d="M 123 210 H 1071" />
      </symbol>
    </svg>
  )
}
