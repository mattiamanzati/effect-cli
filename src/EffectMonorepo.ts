import * as HttpClient from "@effect/platform/HttpClient"
import * as HttpClientResponse from "@effect/platform/HttpClientResponse"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as PackageJson from "./PackageJson.js"
import * as PackageManager from "./PackageManager.js"

export function parseEffectMonorepoDirectory(packageJson: PackageJson.PackageJson) {
  return Option.gen(function*() {
    const repository = yield* packageJson.repository
    if (typeof repository === "string") return yield* Option.none()
    const url = yield* repository.url
    if (url.toLowerCase().indexOf("/effect-ts/effect") === -1) return yield* Option.none()
    return yield* repository.directory
  })
}

export class NotAnEffectMonorepoPackage extends Data.TaggedError("NotAnEffectMonorepoPackage")<{
  package: string
}> {
  get message() {
    return `Package ${this.package} is not part of the effect monorepo.`
  }
}

export function getEffectGithubMonorepoPackageJson(
  releaseTag: PackageJson.PackageNameAndVersion,
  packageToGet: string
) {
  return Effect.gen(function*() {
    // run npm view just to get the directory
    const packageJson = yield* PackageManager.view(packageToGet)
    // get the monorepo directory
    const packageToGetDirectory = parseEffectMonorepoDirectory(packageJson)
    if (Option.isNone(packageToGetDirectory)) {
      return yield* new NotAnEffectMonorepoPackage({ package: packageToGet })
    }
    // run the http request
    return yield* HttpClient.get(
      `https://raw.githubusercontent.com/Effect-TS/effect/${releaseTag.toNameAndVersionSpecifier()}/${packageToGetDirectory.value}/package.json`
    ).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(PackageJson.PackageJson))
    )
  })
}
