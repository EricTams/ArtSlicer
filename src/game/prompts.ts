/**
 * Prompts are deliberately concrete: the joke is in how badly a pile of
 * geometric junk approximates something specific, and a vague prompt gives
 * voters nothing to judge against.
 *
 * Three kinds, kept in one list because a game shuffles it once and draws from
 * the front — so a long game moves between them rather than settling into one
 * move:
 *
 * - a thing to make, where the vote goes to whoever's is most recognisable;
 * - a superlative, where the vote is whose is *most*, and being recognisable
 *   does not come into it;
 * - a mood, which is the squish and colour tools' round rather than the parts
 *   bin's, since what has been done to a piece carries a mood better than
 *   which piece it was.
 */
export const PROMPTS: readonly string[] = [
  'a very tired dog',
  'the world’s worst sandwich',
  'a haunted lighthouse',
  'your boss, but as a robot',
  'a cat plotting revenge',
  'the last slice of pizza',
  'a rocket that will not make it',
  'an octopus doing taxes',
  'a birthday cake that went wrong',
  'a knight who lost their horse',
  'the sun on a bad day',
  'a submarine full of bees',
  'a very fancy chicken',
  'a traffic jam',
  'a dragon with a head cold',
  'the moon landing, but cheaper',
  'a snowman in July',
  'a pirate ship made of junk',
  'an alien tourist',
  'a haunted vending machine',
  'a giraffe in a small car',
  'the concept of Monday',
  'a wizard who forgot the spell',
  'a hamburger with ambitions',
  'a lonely traffic cone',
  'a shark wearing a hat',
  'a cat in a hat',
  'a driving dog',
  'a racing turtle',
  'a grumpy owl',
  'a scruffy lion',
  'a frog in boots',
  'a shy monster',
  'a giant bee',
  'a soggy butterfly',
  'a melting ice cream',
  'a cake castle',
  'a dragon’s birthday',
  'a saucepan knight',
  'a wonky unicorn',
  'a penguin on holiday',
  'a spider in a scarf',
  'a flying pig',
  'a cow on the moon',
  'a giant duck',
  'an octopus goalkeeper',
  'an elephant on a bike',
  'a dancing bear',
  'a lost astronaut',
  'a posh worm',
  'a pirate’s parrot',
  'the most expensive thing',
  'the most dangerous snack',
  'the wobbliest tower',
  'the most useless machine',
  'the silliest hat',
  'the loudest thing',
  'the smelliest sock',
  'the comfiest chair',
  'the worst pet',
  'the prettiest mess',
  'something that looks guilty',
  'something very angry',
  'something very happy',
  'something that just woke up',
  'something showing off',
  'something that gave up',
  'something very proud',
  'something in a sulk',
  'something in love',
  'something very nervous',
]

/**
 * Fisher-Yates over a copy. The host shuffles once per game and draws from the
 * front, so a single game never repeats a prompt.
 */
export function shufflePrompts(source: readonly string[] = PROMPTS): string[] {
  const pool = [...source]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j]!, pool[i]!]
  }
  return pool
}
