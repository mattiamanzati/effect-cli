import * as Args from "@effect/cli/Args"
import * as Command from "@effect/cli/Command"
import * as Options from "@effect/cli/Options"
import * as ReadonlyArray from "effect/Array"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"
import * as HashSet from "effect/HashSet"
import * as PackageJson from "./PackageJson.js"
import * as PackageManager from "./PackageManager.js"
import * as PackageResolver from "./PackageResolver.js"
import * as ResolutionAlgo from "./ResolutionAlgo.js"

const packages = Args.text({ name: "package" }).pipe(
  Args.withDescription("List of the effect packages you'd like to install"),
  Args.repeated
)

const save = Options.boolean("save").pipe(
  Options.withDefault(false),
  Options.withDescription("Save into the dependencies the packages")
)

const saveDev = Options.boolean("save-dev").pipe(
  Options.withDefault(false),
  Options.withDescription("Save into the dev dependencies the packages")
)

const savePeer = Options.boolean("save-peer").pipe(
  Options.withDefault(false),
  Options.withDescription("Save into the dev dependencies the packages")
)

const excludeEffectPeers = Options.boolean("exclude-effect-peers").pipe(
  Options.withDefault(false),
  Options.withDescription("Installs peer effect packages as well")
)

const install = Command.make(
  "install",
  { packages, save, saveDev, savePeer, excludeEffectPeers },
  (args) =>
    Effect.gen(function*() {
      const effectPackageJson = yield* ResolutionAlgo.getInstalledEffectPackageJson
      yield* Effect.logInfo("Detected installed effect@" + effectPackageJson.version)

      yield* Effect.log("Checking compatibility...")
      const { allToInstall, alternativeCompatible, effectMismatch } = yield* ResolutionAlgo.process(
        effectPackageJson.nameAndVersion,
        args.packages
      )

      let peersToInstall = HashSet.empty<PackageJson.PackageNameAndVersion>()
      if (!args.excludeEffectPeers) {
        yield* Effect.log("Resolving effect peer-deps...")
        const { peers } = yield* ResolutionAlgo.resolveRequiredPeers(allToInstall)
        peersToInstall = peers
      }

      for (const mismatch of effectMismatch) {
        yield* Effect.logError(
          mismatch.package + " requires " +
            mismatch.expectedEffect
        )
      }
      for (const alternative of alternativeCompatible) {
        yield* Effect.logWarning(alternative.nameAndVersion + " will be used instead")
      }

      if (HashSet.size(peersToInstall) > 0) {
        yield* Effect.logWarning("Following packages will be added as well " + Array.from(peersToInstall).join(" "))
      }

      if (HashSet.size(allToInstall) > 0) {
        yield* Effect.log("About to install packages " + Array.from(allToInstall).join(" "))
        yield* PackageManager.install(allToInstall, args)
      }

      if (HashSet.size(peersToInstall) > 0) {
        yield* Effect.log("About to install peers " + Array.from(peersToInstall).join(" "))
        yield* PackageManager.install(peersToInstall, args)
      }
    })
)

const version = Args.text({ name: "version" }).pipe(
  Args.withDefault("latest"),
  Args.withDescription("What version to update effect to")
)

const update = Command.make(
  "update",
  { version },
  (args) =>
    Effect.gen(function*() {
      yield* Effect.logInfo("Reading package.json...")
      const myPackageJson = yield* PackageResolver.readPackageJson("package.json")

      const newEffectPackageJson = yield* PackageManager.view("effect@" + args.version)
      yield* Effect.logInfo("Checking packages for " + newEffectPackageJson.nameAndVersion)

      yield* Effect.logInfo("Checking installed packages...")
      const installedPackages = pipe(
        yield* ResolutionAlgo.getInstalledMonorepoPackages,
        ReadonlyArray.filter((_) => _.name !== "effect"),
        ReadonlyArray.append(newEffectPackageJson),
        ReadonlyArray.map((_) => _.nameAndVersion)
      )

      yield* Effect.logInfo(
        "Checking compatibility of " + installedPackages.join(" ") + "..."
      )
      const { allToInstall, alternativeCompatible, effectMismatch } = yield* ResolutionAlgo.process(
        newEffectPackageJson.nameAndVersion,
        installedPackages.map((_) => _.toNameAndVersionSpecifier())
      )

      for (const mismatch of effectMismatch) {
        yield* Effect.logError(mismatch.package + " requires " + mismatch.expectedEffect)
      }
      for (const alternative of alternativeCompatible) {
        yield* Effect.logWarning(alternative.nameAndVersion + " will be used instead")
      }

      const devDeps = PackageJson.filterSavedInDeps(myPackageJson.devDependencies, allToInstall)
      if (HashSet.size(devDeps) > 0) {
        yield* Effect.log("About to install dev dependencies " + Array.from(devDeps).join(" "))
        yield* PackageManager.install(devDeps, { save: false, saveDev: true, savePeer: false })
      }

      const deps = PackageJson.filterSavedInDeps(myPackageJson.dependencies, allToInstall)
      if (HashSet.size(deps) > 0) {
        yield* Effect.log("About to install dependencies " + Array.from(deps).join(" "))
        yield* PackageManager.install(deps, { save: true, saveDev: false, savePeer: false })
      }
    })
)

const doctor = Command.make(
  "doctor",
  {},
  () =>
    Effect.gen(function*() {
      const newEffectPackageJson = yield* ResolutionAlgo.getInstalledEffectPackageJson
      yield* Effect.logInfo("Checking packages for " + newEffectPackageJson.nameAndVersion)

      yield* Effect.logInfo("Checking installed packages...")
      const installedPackages = pipe(
        yield* ResolutionAlgo.getInstalledMonorepoPackages,
        ReadonlyArray.filter((_) => _.name !== "effect"),
        ReadonlyArray.map((_) => _.nameAndVersion)
      )

      if (installedPackages.length === 0) return yield* Effect.log("No installed effect packages.")

      yield* Effect.logInfo(
        "Checking compatibility of " + installedPackages.join(" ") + "..."
      )
      const { compatible, effectMismatch } = yield* ResolutionAlgo.process(
        newEffectPackageJson.nameAndVersion,
        installedPackages.map((_) => _.toNameAndVersionSpecifier())
      )

      for (const mismatch of effectMismatch) {
        yield* Effect.logError(mismatch.package + " requires " + mismatch.expectedEffect)
      }

      yield* Effect.log("compatible packages " + compatible.map((_) => _.nameAndVersion).join(" "))
    })
)

const effectCli = Command.make(
  "effect-cli"
).pipe(
  Command.withSubcommands([install, update, doctor])
)

export const run: any = Command.run(effectCli, {
  name: "Effect CLI",
  version: "0.0.1"
})
