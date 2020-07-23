import * as path from 'path'
import webpack from 'webpack'
import { Configuration as DevServerConfig } from 'webpack-dev-server'

interface Options {
  isDev: boolean
}

const tsRule: webpack.Rule = {
  test: /\.[tj]sx?$/,
  include: path.resolve(__dirname, 'src'),
  use: [
    {
      loader: 'ts-loader',
      options: {
        experimentalWatchApi: true,
        transpileOnly: true,
      },
    },
  ],
}

const devServer: DevServerConfig = {
  contentBase: path.join(__dirname, 'dist'),
  hotOnly: true,
  overlay: {
    warnings: false,
    errors: true,
  },
}

function shared({ isDev }: Options): webpack.Configuration {
  return {
    context: path.resolve(__dirname),
    devtool: isDev ? undefined : 'source-map',
    devServer,
    stats: {
      assets: false,
      maxModules: 3,
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    module: {
      rules: [tsRule],
    },
  }
}

function config(cb: (opts: Options) => webpack.Configuration) {
  return (env: any, args: any) => {
    const { mode = 'development' } = args
    const opts = { isDev: mode === 'development' }
    const conf = cb(opts)

    return Object.assign(
      {},
      shared(opts),
      { mode } as webpack.Configuration,
      conf
    )
  }
}

const cacheDirectory = path.resolve(__dirname, '.cache/hard-source/[confighash]')

export default [
  config(() => ({
    output: {
      filename: 'cambriamerge.js',
      library: 'Cambriamerge',
      libraryTarget: 'umd',
      path: path.resolve(__dirname, 'dist'),
      globalObject: 'this'
    },
    name: 'cambriamerge',
    entry: ['./src/cambriamerge.ts'],
  })),
]
