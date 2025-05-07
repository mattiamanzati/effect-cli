import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as PackageJson from "./PackageJson.js"
import * as PackageResolver from "./PackageResolver.js"

class EffectPackageNotFoundError extends Data.TaggedError("EffectPackageNotFoundError") {}

class MultipleEffectPackagesFoundError extends Data.TaggedError("MultipleEffectPackagesFoundError")<{
  versions: Array<PackageJson.PackageNameAndVersion>
}> {}

export const getInstalledEffect = Effect.gen(function*() {
  const foundInstalled = HashSet.filter(yield* PackageResolver.listInstalled, (_) => _.name === "effect")
  if (HashSet.size(foundInstalled) === 0) return yield* new EffectPackageNotFoundError()
  if (HashSet.size(foundInstalled) > 1) {
    return yield* new MultipleEffectPackagesFoundError({ versions: HashSet.toValues(foundInstalled) })
  }
  return HashSet.toValues(foundInstalled)[0]
})

class NoPackageVersionCompatibleWithEffectError extends Data.TaggedError("NoPackageVersionCompatibleWithEffectError")<{
  packageSpec: PackageJson.PackageNameAndVersion
  effect: PackageJson.PackageNameAndVersion
}> {
  get message() {
    return `No version of ${this.packageSpec} is compatible with ${this.effect}`
  }
}

class NoCandidateForPackageCompatibleWithPeers extends Data.TaggedError("NoCandidateForPackageCompatibleWithPeers")<{
  packageSpec: PackageJson.PackageNameAndVersion
}> {}

export function process(
  installedEffect: PackageJson.PackageNameAndVersion,
  requestedPackages: Array<PackageJson.PackageNameAndVersion>,
  alreadyInstalledPackages: HashSet.HashSet<PackageJson.PackageNameAndVersion>
) {
  return Effect.gen(function*() {
    const installedEffectAsHash = HashSet.fromIterable([installedEffect])
    const requestedPackageNames = Array.map(requestedPackages, (_) => _.name)
    yield* Effect.logInfo("Searching effect-compatible " + requestedPackages.join(" "))

    let allCompatiblePackages: Array<PackageJson.PackageJson> = []
    let allPeerPackages = HashSet.empty<string>()

    for (const pkg of requestedPackages) {
      const packageList = yield* PackageResolver.list(pkg)
      const effectMatchedList = pipe(
        packageList,
        Array.map((_) => PackageJson.matchPeers(_, installedEffectAsHash)),
        Array.filter((_) => _.hasValid(installedEffect))
      )

      if (effectMatchedList.length === 0) {
        return yield* new NoPackageVersionCompatibleWithEffectError({ packageSpec: pkg, effect: installedEffect })
      }

      allCompatiblePackages = Array.appendAll(
        allCompatiblePackages,
        Array.map(effectMatchedList, (_) => _.packageJson)
      )
      yield* Effect.logDebug(pkg + ": " + Array.map(effectMatchedList, (_) => _.packageJson.version).join(" "))
      const peerNamesForMatches = pipe(
        effectMatchedList,
        Array.map((_) => HashSet.toValues(_.missing)),
        Array.flatten,
        Array.map((_) => _.name),
        HashSet.fromIterable
      )
      allPeerPackages = HashSet.union(allPeerPackages, peerNamesForMatches)
    }

    yield* Effect.logInfo("involved peers " + Array.fromIterable(allPeerPackages).join(" "))

    const installedPeers = pipe(
      alreadyInstalledPackages,
      HashSet.filter((_) => HashSet.has(allPeerPackages, _.name)),
      HashSet.filter((_) => requestedPackageNames.indexOf(_.name) === -1)
    )

    if (HashSet.size(installedPeers) > 0) {
      yield* Effect.logInfo(
        "Checking packages compatible with already installed " + Array.fromIterable(installedPeers).join(" ")
      )
    }

    let currentCandidates = allCompatiblePackages
    let finalInstallSet = HashSet.empty<PackageJson.PackageJson>()

    while (true) {
      let candidateRemoved = false
      finalInstallSet = HashSet.empty()
      for (const requestedPkg of requestedPackages) {
        // start by picking the latest version
        const versionToTest = Array.findLast(currentCandidates, (candidate) => candidate.name === requestedPkg.name)
        if (Option.isNone(versionToTest)) {
          return yield* new NoCandidateForPackageCompatibleWithPeers({ packageSpec: requestedPkg })
        }
        const pickedVersion = versionToTest.value

        const peersForTest = pipe(
          installedPeers,
          HashSet.union(HashSet.fromIterable(Array.map(currentCandidates, (_) => _.nameAndVersion)))
        )

        const testResult = PackageJson.matchPeers(pickedVersion, peersForTest)
        // this package is satisfied, go to next
        if (testResult.hasAllPeer(true)) {
          finalInstallSet = HashSet.add(finalInstallSet, pickedVersion)
          continue
        }

        // we are not, exclude this candidate and retry
        yield* Effect.logDebug(
          pickedVersion.nameAndVersion + " is not satisfied by peers "
        )
        candidateRemoved = true
        currentCandidates = Array.filter(currentCandidates, (_) => !Equal.equals(_, pickedVersion))
        break
      }
      if (!candidateRemoved) break
    }
    return finalInstallSet
  })
}

export function listDependenciesRequireEffect(packageJson: PackageJson.PackageJson) {
  return Effect.gen(function*() {
    const paths = yield* PackageResolver.listPathsFor(packageJson.anyDependencies)

    return pipe(
      yield* Effect.forEach(paths, (_) => PackageResolver.readPackageJson(_)),
      Array.filter((_) => "effect" in _.peerDependencies),
      Array.map((_) => _.nameAndVersion)
    )
  })
}
