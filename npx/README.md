# lararium

The one-line door into the [lararium](https://github.com/kylnor/lararium) template. It
fetches the latest release, unpacks it into a new folder, and gets out of the way. No dependencies,
node stdlib only.

```
npx lararium [folder]
```

That's the whole tool. It resolves the newest tagged release from GitHub, downloads that tarball,
unpacks it into `folder` (default `lararium`), strips its own scaffolder code out of the copy,
runs `git init` with a first commit, and prints what to do next:

```
cd <folder>
claude
```

Then say: "Run the install interview in `INSTALL.md`". That interview is the actual install; this
package only gets the files onto your disk.

**Note on versioning:** this package's own version (`0.1.0` and up) is unrelated to the template's
`STACK_VERSION`. The scaffolder always fetches whatever the latest template release is at run time;
bumping this package is only for fixing the scaffolder itself.

## Publishing (for the template's owner)

Requires an npm login with publish rights on the `lararium` package name. From this directory:

```
npm publish
```

Bump `version` in `package.json` first if anything in `index.js` changed. The published package
version stays decoupled from `STACK_VERSION`; do not try to keep them in sync.
