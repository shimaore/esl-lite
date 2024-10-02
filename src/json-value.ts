/**
 * Type declaration for a JSON value.
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue }

export const jsonParseBuffer = (b: Buffer): JSONValue =>
  // @ts-expect-error @types/node does not know that JSON.parse accepts Buffer.
  JSON.parse(b) as JSONValue
