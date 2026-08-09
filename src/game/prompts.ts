/**
 * Prompts are deliberately concrete nouns rather than abstract ideas: the joke
 * is in how badly a pile of geometric junk approximates something specific,
 * and a vague prompt gives voters nothing to judge against.
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
