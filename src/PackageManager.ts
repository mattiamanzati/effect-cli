import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as PlatformError from "@effect/platform/Error"
import * as Array$ from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { identity, pipe } from "effect/Function"
import type * as HashSet from "effect/HashSet"
import type * as PackageJson from "./PackageJson.js"

export class PackageManagerError extends Data.TaggedError("PackageManagerError")<{
  issue: PlatformError.PlatformError
}> {}

export const install = (packageNames: HashSet.HashSet<PackageJson.PackageNameAndVersion>, opts: {
  save: boolean
  saveDev: boolean
  savePeer: boolean
}) =>
  Effect.gen(function*() {
    const executor = yield* CommandExecutor.CommandExecutor
    const saveOpts = pipe(
      Array$.empty<string>(),
      opts.save ? Array$.append("--save") : identity,
      opts.saveDev ? Array$.append("--save-dev") : identity,
      opts.savePeer ? Array$.append("--save-peer") : identity,
      (opts.save || opts.saveDev || opts.savePeer) ? Array$.append("--save-exact") : identity
    )
    const command = Command.make(
      "pnpm",
      "add",
      ...Array.from(packageNames).map((_) => _.toNameAndVersionSpecifier()),
      ...saveOpts
    ).pipe(
      Command.stderr("inherit"),
      Command.stdout("inherit"),
      Command.stdin("inherit")
    )
    const handle = yield* executor.start(command).pipe(
      Effect.mapError((issue) => new PackageManagerError({ issue }))
    )
    yield* handle.exitCode
  }).pipe(Effect.scoped)

export const dedupe = Effect.gen(function*() {
  const executor = yield* CommandExecutor.CommandExecutor

  const command = Command.make(
    "pnpm",
    "dedupe"
  ).pipe(
    Command.stderr("inherit"),
    Command.stdout("inherit"),
    Command.stdin("inherit")
  )
  const handle = yield* executor.start(command).pipe(
    Effect.mapError((issue) => new PackageManagerError({ issue }))
  )
  yield* handle.exitCode
}).pipe(Effect.scoped)
