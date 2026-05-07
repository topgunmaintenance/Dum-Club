/**
 * JsonLd — renders Schema.org objects as <script type="application/ld+json">
 * tags. Used by the project + embed pages to expose merchant + offer
 * data to Google rich results and AI crawlers.
 *
 * Accepts either a single object or an array. Falsy entries (null /
 * undefined) are dropped, so callers can pass conditional schemas
 * without wrapping each one in their own guard:
 *
 *   <JsonLd data={[
 *     buildLocalBusinessSchema(project, offers),   // always
 *     buildBroadcastEventSchema(project),          // null when offline
 *   ]} />
 *
 * Why <\\u003c escaping: a malicious or accidental "</script>"
 * sequence inside any string field would break out of the script tag
 * if inlined verbatim. Replacing < with its unicode escape keeps the
 * JSON parseable while making "</script>" inert as HTML.
 */

type JsonLdData = object | null | undefined;

type JsonLdProps = {
  data: JsonLdData | JsonLdData[];
};

function serialize(item: object): string {
  return JSON.stringify(item).replace(/</g, "\\u003c");
}

export function JsonLd({ data }: JsonLdProps) {
  const items: object[] = (Array.isArray(data) ? data : [data]).filter(
    (x): x is object => Boolean(x)
  );
  if (items.length === 0) return null;

  return (
    <>
      {items.map((item, i) => (
        <script
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serialize(item) }}
        />
      ))}
    </>
  );
}
