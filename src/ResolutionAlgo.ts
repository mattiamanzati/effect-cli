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
  packageName: string
}> {}

export function process(
  installedEffect: PackageJson.PackageNameAndVersion,
  requestedPackages: Array<PackageJson.PackageNameAndVersion>,
  alreadyInstalledPackages: HashSet.HashSet<PackageJson.PackageNameAndVersion>
) {
  return Effect.gen(function*() {
    let currentInstalled = alreadyInstalledPackages
    let currentRequestList = requestedPackages
    let repeatAgain = true
    let lastInstallSet = HashSet.empty<PackageJson.PackageJson>()
    while (repeatAgain) {
      repeatAgain = false
      lastInstallSet = yield* processIteration(installedEffect, currentRequestList, currentInstalled)
      for (const toInstall of lastInstallSet) {
        currentInstalled = pipe(
          currentInstalled,
          HashSet.filter((_) => _.name !== toInstall.name),
          HashSet.add(toInstall.nameAndVersion)
        )
        for (const dependency of toInstall.anyDependencies) {
          if (dependency.name === "effect") continue
          if (!dependency.name.startsWith("@effect")) continue
          if (Option.isSome(Array.findFirst(currentRequestList, (_) => _.name === dependency.name))) continue
          if (HashSet.size(HashSet.filter(currentInstalled, (_) => _.name === dependency.name)) > 0) continue
          currentRequestList = Array.append(currentRequestList, dependency)
          repeatAgain = true
        }
      }
    }

    return HashSet.map(lastInstallSet, (_) => _.nameAndVersion)
  })
}

function processIteration(
  installedEffect: PackageJson.PackageNameAndVersion,
  requestedPackages: Array<PackageJson.PackageNameAndVersion>,
  alreadyInstalledPackages: HashSet.HashSet<PackageJson.PackageNameAndVersion>
) {
  return Effect.gen(function*() {
    const installedEffectAsHash = HashSet.fromIterable([installedEffect])
    const requestedPackageNames = Array.map(requestedPackages, (_) => _.name)

    let allCompatiblePackages: Array<PackageJson.PackageJson> = []

    for (const pkg of requestedPackages) {
      const packageVersionsCompatibleWithEffect = pipe(
        yield* PackageResolver.list(pkg),
        Array.map((_) => PackageJson.matchPeers(_, installedEffectAsHash)),
        Array.filter((_) => _.hasValid(installedEffect))
      )
      allCompatiblePackages = Array.appendAll(
        allCompatiblePackages,
        Array.map(packageVersionsCompatibleWithEffect, (_) => _.packageJson)
      )
    }

    for (const packageSpec of requestedPackages) {
      const versionToTest = Array.findLast(allCompatiblePackages, (candidate) => candidate.name === packageSpec.name)
      if (Option.isNone(versionToTest)) {
        return yield* new NoPackageVersionCompatibleWithEffectError({ effect: installedEffect, packageSpec })
      }
    }

    const installedPeers = pipe(
      alreadyInstalledPackages,
      HashSet.filter((_) => requestedPackageNames.indexOf(_.name) === -1)
    )

    let currentCandidates = allCompatiblePackages
    let finalInstallSet = HashSet.empty<PackageJson.PackageJson>()

    while (true) {
      let candidateRemoved = false
      finalInstallSet = HashSet.empty()
      for (const packageName of requestedPackageNames) {
        // start by picking the latest version
        const versionToTest = Array.findLast(currentCandidates, (candidate) => candidate.name === packageName)
        if (Option.isNone(versionToTest)) {
          return yield* new NoCandidateForPackageCompatibleWithPeers({ packageName })
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
    const paths = yield* PackageResolver.listPathsFor(Array.map(packageJson.anyDependencies, (_) => _.name))

    return pipe(
      yield* Effect.forEach(paths, (_) => PackageResolver.readPackageJson(_)),
      Array.filter((_) => "effect" in _.peerDependencies)
    )
  })
}
