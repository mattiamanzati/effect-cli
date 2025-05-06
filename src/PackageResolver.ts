import type * as PlatformError from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Array$ from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as PackageJson from "./PackageJson.js"

export class CannotResolvePackageJsonPathError extends Data.TaggedError("CannotResolvePackageJsonPathError")<{
  packageName: string
  issue: unknown
}> {}

export class PackageJsonFileNotFound extends Data.TaggedError("PackageJsonFileNotFound")<{
  path: string
  issue: PlatformError.PlatformError
}> {
  get message() {
    return "Cannot find the package JSON file at location: " + this.path + ".\n\n" + this.issue
  }
}

export const readPackageJson = Effect.fn(function*(path: string) {
  const fs = yield* FileSystem.FileSystem
  const contents = yield* fs.readFileString(path).pipe(
    Effect.mapError((issue) => new PackageJsonFileNotFound({ path, issue }))
  )
  return yield* PackageJson.decodeJsonString(contents)
})

export const resolvePathForPackage = (packageName: string) =>
  Effect.try({
    // @ts-expect-error
    try: () => (require as any).resolve(packageName + "/package.json"),
    catch: (issue) => new CannotResolvePackageJsonPathError({ packageName, issue })
  }).pipe(
    Effect.orElse(
      () =>
        Effect.try({
          try: () => import.meta.resolve(packageName + "/package.json"),
          catch: (issue) => new CannotResolvePackageJsonPathError({ packageName, issue })
        })
    ),
    Effect.map((path) => path.startsWith("file://") ? path.substring("file://".length) : path)
  )

export const readLocalPackageJsonForPackage = Effect.fn(
  function*(packageName: string) {
    const path = yield* resolvePathForPackage(packageName)
    return yield* readPackageJson(path)
  }
)

export function excludeInstalledPackages(packages: HashSet.HashSet<PackageJson.PackageNameAndVersion>) {
  return Effect.gen(function*() {
    const installed = yield* Effect.allSuccesses(
      HashSet.toValues(packages).map((pkg) => readLocalPackageJsonForPackage(pkg.name))
    )
    return Array$.reduce(installed, packages, (acc, _) => HashSet.remove(acc, _.nameAndVersion))
  })
}
