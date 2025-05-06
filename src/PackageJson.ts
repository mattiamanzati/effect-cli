import { Effect } from "effect"
import * as Data from "effect/Data"
import * as HashSet from "effect/HashSet"
import type { ParseError } from "effect/ParseResult"
import * as Schema from "effect/Schema"

export const DependenciesRecord = Schema.Record({
  key: Schema.NonEmptyString,
  value: Schema.NonEmptyString
})
export type DependenciesRecord = Schema.Schema.Type<typeof DependenciesRecord>

export class RepositoryInfo extends Schema.Class<RepositoryInfo>("RepositoryInfo")({
  url: Schema.optionalWith(Schema.NonEmptyString, { as: "Option" }),
  directory: Schema.optionalWith(Schema.NonEmptyString, { as: "Option" })
}) {}

export class PackageJson extends Schema.Class<PackageJson>("PackageJson")({
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  repository: Schema.optionalWith(Schema.Union(RepositoryInfo, Schema.String), { as: "Option" }),
  dependencies: Schema.optionalWith(
    DependenciesRecord,
    { default: () => ({}) }
  ),
  devDependencies: Schema.optionalWith(
    DependenciesRecord,
    { default: () => ({}) }
  ),
  peerDependencies: Schema.optionalWith(
    DependenciesRecord,
    { default: () => ({}) }
  )
}) {
  get nameAndVersion(): PackageNameAndVersion {
    return new PackageNameAndVersion({ name: this.name, version: this.version })
  }
}

export class PackageNameAndVersion extends Data.Class<{
  name: string
  version: string
}> {
  toNameAndVersionSpecifier() {
    return this.name + "@" + this.version
  }
  toString() {
    return this.toNameAndVersionSpecifier()
  }
}

export const decodeJsonString = (contents: string) =>
  Schema.decodeUnknown(Schema.parseJson(PackageJson))(contents).pipe(
    Effect.mapError((issue) => new MalformedPackageJsonError({ contents, issue }))
  )

export const toNameAndVersion = (p: PackageJson) => p.name + "@" + p.version

export class MalformedPackageJsonError extends Data.TaggedError("MalformedPackageJsonError")<{
  contents: string
  issue: ParseError
}> {
  get message() {
    return "Encountered an issue parsing the package.json:\n\n" + this.issue.toString()
  }
}

export function filterSavedInDeps(dependencies: DependenciesRecord, deps: HashSet.HashSet<PackageNameAndVersion>) {
  return HashSet.filter(deps, (_) => _.name in dependencies)
}
