/**
 * Source of truth for the generated prop pieces.
 *
 * Every entry is one silly object with a strong silhouette and a pattern that
 * belongs on it, spread across four shape families so the tray does not fill up
 * with variations on a circle. The shared style block is what keeps forty
 * separate generations looking like one set, and the flat green field is what
 * scripts/chroma-key.mjs keys out — see that file before changing the wording.
 */

export const STYLE =
  'Photorealistic studio product photograph of one single object, shot straight ' +
  'on at eye level, tack sharp, evenly lit with soft diffuse studio light, fine ' +
  'material detail and realistic texture. The object is complete and fully ' +
  'visible, centred, with nothing cropped or cut off. It is shot against a ' +
  'completely flat solid pure green (#00FF00) backdrop, edge to edge, with no ' +
  'cast shadow, no reflection, no surface or floor, no other props, no hands, ' +
  'no text and no watermark.'

/** `family` is descriptive only — every piece lands in the one `props` category. */
export const PROMPTS = [
  // Tall and thin
  { id: 'leg-lamp', family: 'tall', subject: 'a novelty table lamp shaped like a leg in a black fishnet stocking wearing a black high heel, standing on a gold base, topped with a deep red velvet lampshade trimmed along its bottom edge with small round pompoms hanging on strings' },
  { id: 'barber-pole', family: 'tall', subject: 'a barber pole, a cylinder with red white and blue helical stripes spiralling around it, with chrome caps top and bottom' },
  { id: 'candy-cane', family: 'tall', subject: 'a candy cane with glossy red and white twisting stripes and a hooked top' },
  { id: 'bowling-pin', family: 'tall', subject: 'a bowling pin, white with two red bands around its neck' },
  { id: 'trumpet', family: 'tall', subject: 'a brass trumpet standing upright, bell pointing up, with three valves and polished gold shine' },
  { id: 'popsicle', family: 'tall', subject: 'one single ice lolly on one flat wooden stick, a rounded block of bright orange ice with a few melting drips running down its sides' },
  { id: 'corn-dog', family: 'tall', subject: 'a corn dog on a wooden stick, golden battered surface with a speckled crumb pattern and a zigzag of mustard' },
  { id: 'feather-duster', family: 'tall', subject: 'a feather duster with a turned wooden handle and a big plume of soft barbed feathers in pink and purple' },
  { id: 'pineapple', family: 'tall', chroma: 'magenta', subject: 'a pineapple with a golden diamond-scale lattice skin and a spiky green leafy crown' },
  { id: 'cactus-pot', family: 'tall', chroma: 'magenta', subject: 'a tall ribbed green cactus with small spines, planted in a round terracotta pot with a painted smiling face' },

  // Squat and chunky
  { id: 'plunger', family: 'squat', subject: 'a toilet plunger with a red rubber bell and a wooden handle' },
  { id: 'traffic-cone', family: 'squat', subject: 'a traffic cone, bright orange with two white reflective bands and a square black base' },
  { id: 'fire-hydrant', family: 'squat', subject: 'a fire hydrant, bright red with two side valves, a chunky cap and rows of bolt studs' },
  { id: 'whoopee-cushion', family: 'squat', subject: 'a classic novelty whoopee cushion made of pink rubber, a flat round inflated cushion with visible wrinkles and seams, and a long narrow flat rubber tube nozzle sticking straight out of one side' },
  { id: 'garden-gnome', family: 'squat', subject: 'a garden gnome with a tall red pointed hat, a white beard, a blue coat and a tiny shovel' },
  { id: 'toadstool', family: 'squat', subject: 'a toadstool mushroom with a domed red cap covered in white spots and a fat cream stalk' },
  { id: 'picnic-basket', family: 'squat', subject: 'a wicker picnic basket with a visible over-under basket weave, a curved handle and a red checked cloth peeking out of the lid' },
  { id: 'toaster', family: 'squat', subject: 'a chrome two-slot toaster with a mirrored body, a black lever and a round dial, with one slice of toast popping up' },
  { id: 'tin-can', family: 'squat', subject: 'a tin can of soup with a brushed metal rim and a wrapped paper label in bold red and cream stripes' },
  { id: 'enamel-mug', family: 'squat', subject: 'an enamel camping mug, deep blue with white speckle flecks all over it and a chipped white rim' },

  // Round
  { id: 'rubber-duck', family: 'round', subject: 'a classic yellow rubber bath duck toy with an orange bill' },
  { id: 'beach-ball', family: 'round', subject: 'a beach ball made of alternating bright colour panels in red, yellow, blue and white, with a small white cap at the top' },
  { id: 'disco-ball', family: 'round', subject: 'a mirrored disco ball covered in a grid of small square mirror facets, hanging from a short ring' },
  { id: 'golf-ball', family: 'round', subject: 'a white golf ball covered in a regular pattern of round dimples, resting on a red tee' },
  { id: 'globe', family: 'round', chroma: 'magenta', subject: 'a desk globe on a tilted brass stand, blue oceans and green continents, with thin meridian lines' },
  { id: 'bauble', family: 'round', subject: 'a shiny red Christmas bauble with a gold glitter band around its middle and a gold cap with a loop' },
  { id: 'pincushion', family: 'round', subject: 'a red tomato-shaped sewing pincushion studded with pins with coloured round heads' },
  { id: 'watermelon', family: 'round', chroma: 'magenta', subject: 'a whole round watermelon with dark and light green striped rind and a curly stem' },
  { id: 'pom-pom', family: 'round', subject: 'a big fluffy yarn pom-pom in bright pink and orange, shaggy strands sticking out all round' },
  { id: 'dartboard', family: 'round', subject: 'a dartboard with radial red green black and cream wedges, thin wire rings and a bullseye, with one dart stuck in it' },

  // Spindly
  { id: 'lawn-flamingo', family: 'spindly', subject: 'a plastic pink lawn flamingo ornament standing on two thin wire legs' },
  { id: 'umbrella', family: 'spindly', subject: 'a fully open umbrella seen from the side, its canopy arching up in alternating bright red and white panels, with thin metal ribs and a curved wooden crook handle' },
  { id: 'pinwheel', family: 'spindly', subject: 'a paper pinwheel toy on a thin stick, with radial wedges in bright alternating colours and a bead pin in the centre' },
  { id: 'kite', family: 'spindly', subject: 'a diamond kite with bright colour panels and a long trailing string tail tied with small bows' },
  { id: 'windsock', family: 'spindly', subject: 'a striped orange and white windsock cone flying from a thin pole' },
  { id: 'rubber-chicken', family: 'spindly', subject: 'a floppy yellow rubber chicken toy hanging limply in an S curve, with a red comb and wattle' },
  { id: 'jester-hat', family: 'spindly', subject: 'a court jester hat with three long limp points that flop over and droop right down, each tip ending in a gold bell, in a harlequin pattern of alternating purple and gold diamonds' },
  { id: 'deck-chair', family: 'spindly', subject: 'a folding wooden deck chair with striped blue and white canvas slung between its thin frame' },
  { id: 'argyle-sock', family: 'spindly', subject: 'a single long knitted wool dress sock lying softly folded over, knitted all over in a classic argyle pattern of large cream, red and navy diamonds with thin diagonal crossing lines, with a ribbed cuff, nothing wrapped around it' },
  { id: 'bunting', family: 'spindly', subject: 'a short string of triangular bunting pennants, each flag a black and white checkerboard or a solid bright colour, strung along a gently curving cord' },
]
