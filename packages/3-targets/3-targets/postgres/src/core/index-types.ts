import { accessMethodOf, defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { FULL_TEXT_INDEX_TYPE, fullTextIndexType } from './full-text-index-definition';

// Postgres's built-in index access methods (`CREATE INDEX ... USING <method>`),
// which accept any options object, and the full-text index. btree and hash
// serve the equality lookups a foreign key needs; the others do not.
//
// `fullText` is not an access method: its access method is `gin`, and the
// target turns its options into the expression the `gin` index is built over.
export const postgresIndexTypes = defineIndexTypes()
  .add('btree', { options: type('object'), backsForeignKey: true })
  .add('hash', { options: type('object'), backsForeignKey: true })
  .add('gin', { options: type('object'), backsForeignKey: false })
  .add('gist', { options: type('object'), backsForeignKey: false })
  .add('spgist', { options: type('object'), backsForeignKey: false })
  .add('brin', { options: type('object'), backsForeignKey: false })
  .add(FULL_TEXT_INDEX_TYPE, fullTextIndexType);

export type IndexTypes = typeof postgresIndexTypes.IndexTypes;

/** The access method an index of this type is created with; a type Postgres does not register is its own. */
export function postgresAccessMethodOf(typeLiteral: string): string {
  const entry = postgresIndexTypes.entries.find((candidate) => candidate.type === typeLiteral);
  return entry === undefined ? typeLiteral : accessMethodOf(entry);
}
