import { LINE_BASE, LINE_LG, LINE_SM, PROGRESS, roundUp4 } from '~/ui/virtual/row-metrics'

/**
 * PO card on /pos. One height for every card: the number, the vendor and the date are all
 * `truncate`, and the progress line lives in a fixed box.
 *
 * border 2 + p-3 24 + number 28 + vendor 24 + date 20 + mt-3 12 + progress 36 + gap below 12
 */
export const PO_CARD_HEIGHT = roundUp4(2 + 24 + LINE_LG + LINE_BASE + LINE_SM + 12 + PROGRESS + 12)

/**
 * PO line on /pos/$purchaseId. Two lines are RESERVED for the item name (`line-clamp-2`): that
 * name is what the operator matches against the box in their hands, so truncating it to one line
 * would defeat the screen.
 *
 * border-b 1 + py-3 24 + name 2x24 + code/unit 20 + gap-1 4 + progress 36
 */
export const PO_ITEM_ROW_HEIGHT = roundUp4(1 + 24 + 2 * LINE_BASE + LINE_SM + 4 + PROGRESS)
