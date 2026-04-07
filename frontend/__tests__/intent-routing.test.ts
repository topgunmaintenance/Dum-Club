/**
 * Standing intent routing test set for DUM Club homepage.
 *
 * Run against detectIntent() to validate future routing changes.
 * Each entry: [input, expected_intent, reason]
 *
 * Rules:
 * - CREATE_PHRASES win first (explicit business-building language)
 * - FIND_PHRASES win second (shopping/local discovery language)
 * - Questions → FIND
 * - SERVICE_CATEGORIES → FIND (unless 5+ words + biz signal or article prefix)
 * - ≤4 words → FIND
 * - >4 words → CREATE
 */

type TestCase = [string, "find" | "create", string];

export const INTENT_TEST_SET: TestCase[] = [
  // ── FIND: short service/category queries ──
  ["pizza", "find", "single service category word"],
  ["taco", "find", "single service category word"],
  ["car wash", "find", "two-word service category"],
  ["meal prep", "find", "two-word service category"],
  ["house cleaning", "find", "two-word service category"],
  ["dog walking", "find", "two-word service category"],
  ["personal trainer", "find", "category match on 'trainer'"],
  ["barber", "find", "single category word"],
  ["dentist near me", "find", "category + FIND phrase"],
  ["a pizza", "find", "short with article, ≤4 words"],
  ["a car wash", "find", "short with article, ≤4 words"],
  ["good sushi", "find", "short query, ≤4 words"],

  // ── FIND: explicit search language ──
  ["find me a designer", "find", "FIND phrase 'find'"],
  ["looking for a plumber", "find", "FIND phrase 'looking for'"],
  ["best tacos in Newark", "find", "FIND phrase 'best'"],
  ["cheap pizza", "find", "FIND phrase 'cheap'"],
  ["where can i get a massage", "find", "FIND phrase 'where can i'"],
  ["pizza near me", "find", "FIND phrase 'near me'"],
  ["dog grooming nearby", "find", "FIND phrase 'nearby'"],
  ["how much for car detailing", "find", "FIND phrase 'how much'"],
  ["affordable cleaning service", "find", "FIND phrase 'affordable'"],
  ["show me restaurants", "find", "FIND phrase 'show me'"],

  // ── FIND: questions ──
  ["is there a barber nearby?", "find", "question prefix 'is there'"],
  ["do you have pizza?", "find", "question prefix 'do you'"],
  ["can i get a massage here?", "find", "question prefix 'can i'"],
  ["any good tacos around here?", "find", "FIND phrase 'any' + 'around here'"],

  // ── FIND: short ambiguous ──
  ["food delivery", "find", "2 words, no create signal"],
  ["pet grooming", "find", "2 words, category match"],
  ["web design", "find", "2 words, no category match but ≤4 words"],
  ["yoga classes", "find", "2 words, category match on 'yoga'"],

  // ── CREATE: explicit business-building language ──
  ["I want to sell fitness plans", "create", "CREATE phrase 'i want to sell'"],
  ["help me build a coaching app", "create", "CREATE phrase 'help me build'"],
  ["create a tutoring service", "create", "CREATE phrase 'create a'"],
  ["launch a meal prep company", "create", "CREATE phrase 'launch a'"],
  ["start a cleaning business", "create", "CREATE phrase 'start a'"],
  ["I offer web design services", "create", "CREATE phrase 'i offer'"],
  ["I sell handmade candles online", "create", "CREATE phrase 'i sell'"],
  ["turn this into a real business", "create", "CREATE phrase 'turn this into'"],
  ["my business needs a storefront", "create", "CREATE phrase 'my business'"],

  // ── CREATE: long descriptions with biz signals ──
  ["a premium dog walking business", "create", "5+ words, article, category, biz signal 'business'"],
  ["cleaning company for busy professionals", "create", "5+ words, category, biz signal 'company' + 'for busy'"],
  ["premium pet grooming agency for small businesses", "create", "category + biz signal 'agency' + 'for small'"],
  ["a landscaping service that provides monthly maintenance", "create", "article + category + biz signal 'that provides'"],

  // ── CREATE: long article-led descriptions ──
  ["A mobile car wash service", "create", "5+ words, article prefix, category match"],
  ["An affordable meal prep delivery service", "create", "5+ words, article prefix, category match"],
  ["A premium dog walking and pet sitting service", "create", "5+ words, article prefix, category match"],

  // ── CREATE: long non-category descriptions ──
  ["A SaaS platform for managing remote teams efficiently", "create", ">4 words, no FIND signals"],
  ["An online marketplace for vintage collectors worldwide", "create", ">4 words, no FIND signals"],

  // ── EDGE CASES ──
  ["", "create", "empty input defaults to create"],
  ["a", "find", "single char, ≤4 words"],
  ["hi", "find", "single word, ≤4 words"],
];

/**
 * Usage: import { INTENT_TEST_SET } from './intent-routing.test';
 *
 * for (const [input, expected, reason] of INTENT_TEST_SET) {
 *   const actual = detectIntent(input);
 *   if (actual !== expected) {
 *     console.error(`FAIL: "${input}" → ${actual}, expected ${expected} (${reason})`);
 *   }
 * }
 */
