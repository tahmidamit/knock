import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    esmExternals: false,
  },
  // Fix webpack issues with custom server
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Fix Gun.js issues and optional dependencies
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      stream: false,
      url: false,
      zlib: false,
      http: false,
      https: false,
      assert: false,
      os: false,
      path: false,
    };

    // Ignore Gun.js optional dependencies
    config.resolve.alias = {
      ...config.resolve.alias,
      'aws-sdk': false,
      'gun/lib/rs3': false,
      'gun/lib/rs3.js': false,
    };

    // Add externals to ignore optional dependencies
    if (!isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        'aws-sdk': 'aws-sdk',
        'gun/lib/rs3': 'gun/lib/rs3',
      });
    }

    // Suppress Gun.js SEA dynamic import warnings
    config.module = config.module || {};
    config.module.unknownContextCritical = false;
    config.module.exprContextCritical = false;
    config.module.wrappedContextCritical = false;
    config.module.unknownContextRegExp = /^\.\/.*$/;
    config.module.unknownContextRequest = '.';

    // Add specific warning ignores for Gun.js
    config.ignoreWarnings = config.ignoreWarnings || [];
    config.ignoreWarnings.push(
      /Critical dependency: the request of a dependency is an expression/,
      /Module not found: Error: Can't resolve 'gun'/,
      /Module not found: Error: Can't resolve 'aws-sdk'/
    );
    
    // Ensure proper handling of ES modules
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });

    // Handle Gun.js specific modules
    config.module.rules.push({
      test: /node_modules\/gun\/.*/,
      resolve: {
        fallback: {
          fs: false,
          path: false,
          crypto: false,
        }
      }
    });
    
    return config;
  },
  // Allow access from local network
  allowedDevOrigins: ["192.168.0.103"],
  async rewrites() {
    return []
  },
};

export default nextConfig;
