import type * as PlatformError from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import Arborist from "@npmcli/arborist"
import * as Array$ from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as HashSet from "effect/HashSet"
import pacote from "pacote"
import semver from "semver"
import * as PackageJson from "./PackageJson.js"

export class PackageJsonFileNotFound extends Data.TaggedError("PackageJsonFileNotFound")<{
  packageJsonPath: string
  issue: PlatformError.PlatformError
}> {
  get message() {
    return "Cannot find the package JSON file at location: " + this.packageJsonPath + ".\n\n" + this.issue
  }
}

export const readPackageJson = Effect.fn(function*(packagePath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const packageJsonPath = path.resolve(packagePath, "package.json")
  const contents = yield* fs.readFileString(packageJsonPath).pipe(
    Effect.mapError((issue) => new PackageJsonFileNotFound({ packageJsonPath, issue }))
  )
  return yield* PackageJson.decodeJsonString(contents)
})

export const listInstalled = Effect.gen(function*() {
  const path = yield* Path.Path
  const arb = new Arborist({ path: path.resolve(".") })
  const rootNode = yield* Effect.promise(() => arb.loadActual())
  return pipe(
    Array$.fromIterable(rootNode.inventory.values()),
    Array$.filter((_) => _.packageName !== null),
    Array$.map((_) => new PackageJson.PackageNameAndVersion({ name: _.packageName, version: _.version })),
    HashSet.fromIterable
  )
})

export const listPathsFor = (packageNames: Array<string>) =>
  Effect.gen(function*() {
    const path = yield* Path.Path
    const arb = new Arborist({ path: path.resolve(".") })
    const rootNode = yield* Effect.promise(() => arb.loadActual())
    return pipe(
      Array$.fromIterable(rootNode.inventory.values()),
      Array$.filter((_) => packageNames.indexOf(_.packageName) > -1),
      Array$.map((_) => _.realpath),
      Array$.dedupe
    )
  })

export const list = (packageSpec: PackageJson.PackageNameAndVersion) =>
  Effect.gen(function*() {
    const result = yield* Effect.promise(() => pacote.packument(packageSpec.toNameAndVersionSpecifier()))
    return pipe(
      Object.keys(result.versions).sort(semver.compareLoose),
      Array$.map((version) => result.versions[version]),
      Array$.filter((pkg) => semver.satisfies(pkg.version, packageSpec.version)),
      Array$.map((pkg) =>
        new PackageJson.PackageJson({
          name: pkg.name,
          version: pkg.version,
          dependencies: pkg.dependencies || {},
          peerDependencies: pkg.peerDependencies || {},
          devDependencies: pkg.devDependencies || {}
        })
      )
    )
  })
