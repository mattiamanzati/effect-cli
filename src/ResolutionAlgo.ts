import * as ReadonlyArray from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Record from "effect/Record"
import * as EffectMonorepo from "./EffectMonorepo.js"
import type * as PackageJson from "./PackageJson.js"
import * as PackageManager from "./PackageManager.js"
import * as PackageResolver from "./PackageResolver.js"

export const getInstalledEffectPackageJson = PackageResolver.readLocalPackageJsonForPackage("effect")

export function getEffectPeerDepFromPackageMonorepo(packageJson: PackageJson.PackageJson) {
  return Effect.gen(function*() {
    if (!("effect" in packageJson.peerDependencies)) return Option.none()
    const effectPackageJson = yield* EffectMonorepo.getEffectGithubMonorepoPackageJson(
      packageJson.nameAndVersion,
      "effect"
    )
    return Option.some(effectPackageJson.nameAndVersion)
  })
}

export class RequiredEffectMismatch extends Data.TaggedClass("RequiredEffectMismatch")<{
  package: PackageJson.PackageNameAndVersion
  expectedEffect: PackageJson.PackageNameAndVersion
  foundInstead: PackageJson.PackageNameAndVersion
}> {}

export function process(installedEffect: PackageJson.PackageNameAndVersion, packageNames: Array<string>) {
  return Effect.gen(function*() {
    // first, for each package, we resolve the package json from npm we would like to install
    const toAddPackageJson = yield* Effect.forEach(packageNames, PackageManager.view, {
      concurrency: "unbounded"
    })
    // for each of those, we get the desidered effect version
    const packagesWithEffectVersion = yield* Effect.forEach(
      toAddPackageJson,
      (packageToAdd) =>
        getEffectPeerDepFromPackageMonorepo(packageToAdd).pipe(
          Effect.map((effect) => ({ effect, package: packageToAdd }))
        )
    )
    // get those with effect mismatching the currently installed one
    const effectMismatch = pipe(
      packagesWithEffectVersion,
      ReadonlyArray.filterMap((_) =>
        Option.gen(function*() {
          const expectedEffect = yield* _.effect
          if (Equal.equals(expectedEffect, installedEffect)) return yield* Option.none()
          return new RequiredEffectMismatch({
            foundInstead: installedEffect,
            expectedEffect,
            package: _.package.nameAndVersion
          })
        })
      )
    )
    // find alternatives for those
    const alternativeCompatible = yield* Effect.forEach(
      effectMismatch,
      (mismatchEffect) =>
        EffectMonorepo.getEffectGithubMonorepoPackageJson(installedEffect, mismatchEffect.package.name)
    )

    const compatible = pipe(
      toAddPackageJson,
      ReadonlyArray.filter(
        (packageJson) =>
          Option.isNone(ReadonlyArray.findFirst(
            effectMismatch,
            (_) => Equal.equals(_.package, packageJson.nameAndVersion)
          ))
      )
    )

    const allToInstall = pipe(
      compatible,
      ReadonlyArray.appendAll(alternativeCompatible),
      ReadonlyArray.map((_) => _.nameAndVersion),
      HashSet.fromIterable
    )

    return { effectMismatch, alternativeCompatible, compatible, allToInstall }
  })
}

export class PeerToProcess extends Data.Class<{
  from: PackageJson.PackageNameAndVersion
  packageName: string
}> {}

export function resolveRequiredPeers(
  packages: HashSet.HashSet<PackageJson.PackageNameAndVersion>
) {
  return Effect.gen(function*() {
    let peers: HashSet.HashSet<PackageJson.PackageNameAndVersion> = HashSet.empty()
    let otherPeers: Record<string, string> = {}
    let toProcess: Array<PeerToProcess> = ReadonlyArray.map(
      ReadonlyArray.fromIterable(packages),
      (_) => new PeerToProcess({ from: _, packageName: _.name })
    )
    let alreadyProcessed = HashSet.empty<PeerToProcess>()

    while (toProcess.length > 0) {
      const entry = toProcess.shift()!
      // do not consider effect itself
      if (entry.packageName === "effect") continue
      if (HashSet.has(alreadyProcessed, entry)) continue

      // get package from monorepo
      yield* Effect.logDebug(
        "Checking " + entry.packageName + " at tag " + entry.from.toNameAndVersionSpecifier() + "..."
      )
      const packageJson = yield* EffectMonorepo.getEffectGithubMonorepoPackageJson(entry.from, entry.packageName)

      // add non-workspace peers
      const nonWorkspacePeers = pipe(
        packageJson.peerDependencies,
        Record.filter((version) => !version.toLowerCase().startsWith("workspace:^"))
      )
      otherPeers = { ...otherPeers, ...nonWorkspacePeers }
      // add peers to queue
      const workspacePeers = pipe(
        packageJson.peerDependencies,
        Record.filter((version) => version.toLowerCase().startsWith("workspace:^")),
        Record.keys,
        ReadonlyArray.map((packageName) => new PeerToProcess({ from: entry.from, packageName }))
      )
      const workspaceDependency = pipe(
        packageJson.dependencies,
        Record.filter((version) => version.toLowerCase().startsWith("workspace:^")),
        Record.keys,
        ReadonlyArray.map((packageName) => new PeerToProcess({ from: entry.from, packageName }))
      )
      toProcess = pipe(
        toProcess,
        ReadonlyArray.appendAll(workspacePeers),
        ReadonlyArray.appendAll(workspaceDependency),
        ReadonlyArray.dedupe
      )
      peers = HashSet.add(peers, packageJson.nameAndVersion)
      alreadyProcessed = HashSet.add(alreadyProcessed, entry)
    }
    peers = HashSet.difference(peers, packages)

    return ({
      peers,
      otherPeers
    })
  })
}

function isProbablyEffectMonorepoPackageByName(packageName: string) {
  if (packageName === "@effect/eslint-plugin") return false
  return packageName === "effect" || packageName.startsWith("@effect/")
}

export const getInstalledMonorepoPackages = Effect.gen(function*() {
  const myPackageJson = yield* PackageResolver.readPackageJson("package.json")
  const effectPackages = pipe(
    Record.keys(myPackageJson.dependencies),
    ReadonlyArray.appendAll(Record.keys(myPackageJson.devDependencies)),
    ReadonlyArray.appendAll(Record.keys(myPackageJson.peerDependencies)),
    ReadonlyArray.map((_) => _.toLowerCase()),
    ReadonlyArray.filter(isProbablyEffectMonorepoPackageByName)
  )
  const packageJsons = yield* Effect.forEach(effectPackages, PackageResolver.readLocalPackageJsonForPackage)
  return pipe(
    packageJsons,
    ReadonlyArray.filter((_) => Option.isSome(EffectMonorepo.parseEffectMonorepoDirectory(_)))
  )
})
