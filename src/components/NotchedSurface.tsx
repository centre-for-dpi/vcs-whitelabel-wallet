import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { walletDesign } from '../../branding.config';

const DASH       = walletDesign.dashPattern;
const DASH_COLOR = walletDesign.dashColor;
const DASH_WIDTH = walletDesign.dashWidth;
export const FRAME_RADIUS  = walletDesign.frameRadius;
export const POCKET_RADIUS = walletDesign.pocketRadius;
export const DIVIDER_GAP   = walletDesign.dividerGap;

/**
 * Builds an SVG path for a card whose TOP corners are rounded but whose BOTTOM
 * corners are SQUARE — so the card reads as inserted into a pocket — with the
 * bottom-center edge bulging outward into a shallow, wide oval tab ("knot")
 * pointing DOWN.
 *
 * `h` is the TOTAL height (card body + tab).  The card body occupies the top
 * `h - ry`; the tab bulges from there down to `h`.  `rx`/`ry` are the tab's
 * horizontal/vertical radii (rx > ry → wide and shallow).
 */
export function buildTabbedPath(
  w: number,
  h: number,
  corner: number,
  rx: number,
  ry: number,
  shoulder = 0,   // fillet radius where the flat edge meets the knot
): string {
  const bodyH = h - ry;
  const cx = w / 2;
  const s = shoulder;
  return [
    `M ${corner},0`,
    `H ${w - corner}`,
    `A ${corner},${corner} 0 0 1 ${w},${corner}`,            // top-right corner (rounded)
    `V ${bodyH}`,                                            // right edge → square bottom-right
    `H ${cx + rx}`,                                          // bottom edge → right of knot
    `A ${s},${s} 0 0 0 ${cx + rx - s},${bodyH + s}`,         // right shoulder (rounded)
    `A ${rx - s},${ry - s} 0 0 1 ${cx - rx + s},${bodyH + s}`,// knot bulging down to (cx, h)
    `A ${s},${s} 0 0 0 ${cx - rx},${bodyH}`,                 // left shoulder (rounded)
    `H 0`,                                                   // bottom edge → square bottom-left
    `V ${corner}`,                                           // left edge up
    `A ${corner},${corner} 0 0 1 ${corner},0`,               // top-left corner (rounded)
    'Z',
  ].join(' ');
}

type DividerProps = {
  width: number;
  /** Tab radii of the card above — the divider hugs a tab of this size. */
  tabRX: number;
  tabRY: number;
  /** Distance the dashed line keeps from the card's bottom edge. */
  gap?: number;
  /** Radius of the rounded corners where the divider meets the side frame. */
  pocketRadius?: number;
};

/**
 * Dashed pocket divider — the rounded TOP edge of the pocket holding the card
 * below.  It runs straight just under the card above, dips in a wide oval
 * around that card's downward tab, and at each end curves DOWN into a rounded
 * corner that meets the side frame.
 *
 * It positions itself: `marginTop = gap - tabRY` lifts it into the tab band so
 * its straight run sits `gap` below the card's square bottom edge.  The layout
 * stays fixed regardless of `pocketRadius`.
 */
export const PocketDivider: React.FC<DividerProps> = ({
  width,
  tabRX,
  tabRY,
  gap = DIVIDER_GAP,
  pocketRadius = POCKET_RADIUS,
}) => {
  const pr = pocketRadius;
  const depth = Math.max(pr, tabRY);          // how far the corners / dip drop below the run
  const height = depth + DASH_WIDTH + 1;
  const marginTop = gap - tabRY;              // sit just below the card's square bottom
  if (!(width > 0)) return <View style={{ height, marginTop }} />;

  const o = DASH_WIDTH / 2;
  const cx = width / 2;
  // The dip is wider than the knot (radii +gap) so the line keeps a uniform
  // gap around the whole knot instead of crowding its shoulders.
  const dx = tabRX + gap;
  const d = [
    `M ${o},${pr}`,                            // left rail connection (corner bottom)
    `A ${pr},${pr} 0 0 1 ${o + pr},0`,         // corner curving DOWN from the straight run
    `H ${cx - dx}`,
    `A ${dx},${tabRY} 0 0 0 ${cx + dx},0`,      // dip around the tab (uniform gap)
    `H ${width - o - pr}`,
    `A ${pr},${pr} 0 0 1 ${width - o},${pr}`,   // corner curving DOWN to the right rail
  ].join(' ');

  return (
    <Svg width={width} height={height} style={{ marginTop }}>
      <Path
        d={d}
        stroke={DASH_COLOR}
        strokeWidth={DASH_WIDTH}
        fill="none"
        strokeDasharray={DASH}
        strokeLinecap="round"
      />
    </Svg>
  );
};

type FrameProps = {
  width: number;
  height: number;
  /** Corner radius, matched to the cards' top corners. */
  corner?: number;
  /** Y where the side rails start — set below the first card so its row has no frame. */
  topInset?: number;
  style?: ViewStyle | ViewStyle[];
};

/**
 * Dashed wallet frame, drawn as a single open-top path: the side rails start at
 * `topInset` (below the first card, so the first row has no frame around it),
 * run down, round the bottom corners, and come back up the other side.  No top
 * line — the first card has no pocket above it; the first divider closes the top.
 */
export const WalletFrame: React.FC<FrameProps> = ({
  width,
  height,
  corner = FRAME_RADIUS,
  topInset = 0,
  style,
}) => {
  if (!(width > 0) || !(height > 0)) return null;
  const o = DASH_WIDTH / 2; // keep the stroke fully inside the box
  const cr = corner;
  const top = topInset + o;
  const d = [
    `M ${o},${top}`,
    `V ${height - cr}`,                                 // down left side
    `A ${cr},${cr} 0 0 0 ${o + cr},${height - o}`,      // rounded bottom-left
    `H ${width - cr}`,                                  // bottom edge
    `A ${cr},${cr} 0 0 0 ${width - o},${height - cr}`,  // rounded bottom-right
    `V ${top}`,                                         // up right side
  ].join(' ');
  return (
    <Svg width={width} height={height} style={style}>
      <Path
        d={d}
        stroke={DASH_COLOR}
        strokeWidth={DASH_WIDTH}
        fill="none"
        strokeDasharray={DASH}
        strokeLinecap="round"
      />
    </Svg>
  );
};

type Props = {
  /** Measured pixel width of the surface (tab geometry needs a real width). */
  width: number;
  /** Total height including the tab band. */
  height: number;
  color: string;
  cornerRadius?: number;
  tabRX?: number;
  tabRY?: number;
  tabShoulder?: number;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

export const NotchedSurface: React.FC<Props> = ({
  width,
  height,
  color,
  cornerRadius = 18,
  tabRX = 38,
  tabRY = 15,
  tabShoulder = 0,
  style,
  children,
}) => {
  const bodyH = height - tabRY;
  return (
    <View style={[{ height }, style]}>
      {width > 0 && (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Path d={buildTabbedPath(width, height, cornerRadius, tabRX, tabRY, tabShoulder)} fill={color} />
        </Svg>
      )}
      {/* Content lives in the card body, above the tab band. */}
      <View style={{ height: bodyH }}>{children}</View>
    </View>
  );
};
