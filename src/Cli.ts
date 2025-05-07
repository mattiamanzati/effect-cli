import * as Args from "@effect/cli/Args"
import * as Command from "@effect/cli/Command"
import * as Options from "@effect/cli/Options"
import { Array, Data, HashSet, pipe } from "effect"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
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

const ignoreInstalled = Options.boolean("ignore-installed").pipe(
  Options.withDefault(false),
  Options.withDescription("Ignore already installed packages versions while searching compatible ones")
)

const install = Command.make(
  "install",
  { packages, save, saveDev, savePeer, ignoreInstalled },
  (args) =>
    Effect.gen(function*() {
      const installedEffect = yield* ResolutionAlgo.getInstalledEffect
      yield* Effect.logInfo("Detected installed " + installedEffect)

      const requestedPackages = yield* Effect.forEach(args.packages, PackageJson.fromSpecifier)
      const alreadyInstalledPackages = !args.ignoreInstalled ? yield* PackageResolver.listInstalled : HashSet.empty()

      const finalInstallSet = yield* ResolutionAlgo.process(
        installedEffect,
        requestedPackages,
        alreadyInstalledPackages
      )

      yield* Effect.logInfo("Installing " + Array.fromIterable(finalInstallSet).join(" "))
      yield* PackageManager.install(finalInstallSet, {
        save: args.save,
        saveDev: args.saveDev,
        savePeer: args.savePeer
      })
    })
)

const version = Args.text({ name: "version" }).pipe(
  Args.withDefault("*"),
  Args.withDescription("Effect version to update to")
)

class NoEffectVersionFoundError extends Data.TaggedError("NoEffectVersionFoundError")<{
  effectSpec: PackageJson.PackageNameAndVersion
}> {
  get message() {
    return `Could not find a package matching ${this.effectSpec}`
  }
}

const update = Command.make(
  "update",
  { version },
  (args) =>
    Effect.gen(function*() {
      yield* Effect.logInfo("Reading package.json...")
      const myPackageJson = yield* PackageResolver.readPackageJson(".")

      yield* Effect.logInfo("Searching effect version...")
      const effectSpec = new PackageJson.PackageNameAndVersion({ name: "effect", version: args.version })
      const maybeEffectVersion = pipe(
        yield* PackageResolver.list(effectSpec),
        Array.last
      )
      if (Option.isNone(maybeEffectVersion)) {
        return yield* new NoEffectVersionFoundError({ effectSpec })
      }
      const chosenEffectVersion = maybeEffectVersion.value.nameAndVersion

      yield* Effect.logInfo("Checking packages using effect...")
      const packagesWithEffect = yield* ResolutionAlgo.listDependenciesRequireEffect(myPackageJson)

      const requestedPackages = packagesWithEffect.map((_) =>
        new PackageJson.PackageNameAndVersion({ name: _.name, version: "*" })
      )
      yield* Effect.logInfo(
        "Searching compatible with " + chosenEffectVersion + " for " + requestedPackages.join(" ")
      )
      const packagesChoses = yield* ResolutionAlgo.process(
        chosenEffectVersion,
        requestedPackages,
        HashSet.fromIterable([chosenEffectVersion])
      )
      const finalInstallSet = pipe(
        packagesChoses,
        HashSet.add(chosenEffectVersion)
      )

      const devDependencies = pipe(
        finalInstallSet,
        HashSet.filter((_) => _.name in myPackageJson.devDependencies)
      )
      const dependencies = pipe(
        finalInstallSet,
        HashSet.difference(devDependencies)
      )

      if (HashSet.size(devDependencies) > 0) {
        yield* Effect.logInfo("Installing devDependencies " + Array.fromIterable(devDependencies).join(" "))
        yield* PackageManager.install(devDependencies, { save: false, saveDev: true, savePeer: false })
      }
      if (HashSet.size(dependencies) > 0) {
        yield* Effect.logInfo("Installing dependencies " + Array.fromIterable(dependencies).join(" "))
        yield* PackageManager.install(dependencies, { save: true, saveDev: false, savePeer: false })
      }

      if (HashSet.size(finalInstallSet) > 0) {
        yield* Effect.logInfo("Deduping...")
        yield* PackageManager.dedupe
      }
    })
)

const doctor = Command.make(
  "doctor",
  {},
  () =>
    Effect.gen(function*() {
      yield* Effect.logInfo("Reading package.json...")
      const myPackageJson = yield* PackageResolver.readPackageJson(".")

      const installedEffect = yield* ResolutionAlgo.getInstalledEffect
      yield* Effect.logInfo("Detected installed " + installedEffect)

      for (const packageJson of yield* ResolutionAlgo.listDependenciesRequireEffect(myPackageJson)) {
        const result = PackageJson.matchPeers(packageJson, HashSet.fromIterable([installedEffect]))
        if (!result.hasValid(installedEffect)) {
          yield* Effect.logError("KO " + packageJson.nameAndVersion + " is incompatible with " + installedEffect)
        } else {
          yield* Effect.log("OK " + packageJson.nameAndVersion)
        }
      }
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
