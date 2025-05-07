import { Effect, pipe } from "effect"
import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as HashSet from "effect/HashSet"
import type { ParseError } from "effect/ParseResult"
import * as Schema from "effect/Schema"
import npa from "npm-package-arg"
import semver from "semver"

export const DependenciesRecord = Schema.Record({
  key: Schema.NonEmptyString,
  value: Schema.NonEmptyString
})
export type DependenciesRecord = Schema.Schema.Type<typeof DependenciesRecord>

const dependenciesToNameVersion = (deps: DependenciesRecord) =>
  Object.entries(deps).map(([name, version]) => new PackageNameAndVersion({ name, version }))

export class PackageJson extends Schema.Class<PackageJson>("PackageJson")({
  name: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
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
  get anyDependencies() {
    return pipe(
      dependenciesToNameVersion(this.dependencies),
      Array.appendAll(dependenciesToNameVersion(this.devDependencies)),
      Array.appendAll(dependenciesToNameVersion(this.peerDependencies)),
      Array.dedupe
    )
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

export const fromSpecifier = (spec: string) =>
  Effect.sync(() => npa(spec)).pipe(Effect.map((_) => new PackageNameAndVersion({ name: _.name!, version: _.rawSpec })))

export class MalformedPackageJsonError extends Data.TaggedError("MalformedPackageJsonError")<{
  contents: string
  issue: ParseError
}> {
  get message() {
    return "Encountered an issue parsing the package.json:\n\n" + this.issue.toString()
  }
}

class PackagePeersMatchResult extends Data.TaggedClass("PackagePeersMatchResult")<{
  packageJson: PackageJson
  missing: HashSet.HashSet<PackageNameAndVersion>
  valid: HashSet.HashSet<PackageNameAndVersion>
  invalid: HashSet.HashSet<PackageNameAndVersion>
}> {
  hasPackageMissing(packageName: string) {
    return HashSet.size(HashSet.filter(this.missing, (_) => _.name === packageName)) > 0
  }
  hasValid(packageSpec: PackageNameAndVersion) {
    return HashSet.has(this.valid, packageSpec)
  }
  hasAllPeer(considerMissingValid: boolean) {
    for (const peerName in this.packageJson.peerDependencies) {
      if (HashSet.size(HashSet.filter(this.valid, (_) => _.name === peerName)) > 0) continue
      if (considerMissingValid && HashSet.size(HashSet.filter(this.missing, (_) => _.name === peerName)) > 0) continue
      return false
    }
    return true
  }
}

export const matchPeers = (
  packageJson: PackageJson,
  peersAvailable: HashSet.HashSet<PackageNameAndVersion>
) => {
  let missing = HashSet.empty<PackageNameAndVersion>()
  let valid = HashSet.empty<PackageNameAndVersion>()
  let invalid = HashSet.empty<PackageNameAndVersion>()
  for (const peerPackageName in packageJson.peerDependencies) {
    const peerPackageVersionSpecifier = packageJson.peerDependencies[peerPackageName]
    const peersAvailableForThisPackage = HashSet.filter(peersAvailable, (_) => _.name === peerPackageName)
    if (HashSet.size(peersAvailableForThisPackage) === 0) {
      missing = HashSet.add(
        missing,
        new PackageNameAndVersion({ name: peerPackageName, version: peerPackageVersionSpecifier })
      )
    } else {
      const peersThatSatisfy = HashSet.filter(
        peersAvailableForThisPackage,
        (_) => semver.satisfies(_.version, peerPackageVersionSpecifier)
      )
      valid = HashSet.union(valid, peersThatSatisfy)
      invalid = HashSet.union(invalid, HashSet.difference(peersAvailableForThisPackage, peersThatSatisfy))
    }
  }
  return new PackagePeersMatchResult({ packageJson, missing, valid, invalid })
}
