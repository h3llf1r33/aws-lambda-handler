#!/bin/bash

VERSION_TYPE=$1

if [ -z "$VERSION_TYPE" ]; then
    echo "Error: Version type is required"
    echo "Usage: ./release.sh <version-type>"
    echo "Available types: major, minor, patch, premajor, preminor, prepatch"
    exit 1
fi

# Get current version for comparison
CURRENT_VERSION=$(node -p "require('./package.json').version")

# First bump the version
NEW_VERSION=$(npm --no-git-tag-version version $VERSION_TYPE)

# Stage, commit, publish and push all changes in your repo keep attention to it when you will release a package.
git add .
git commit -m "Release $VERSION_TYPE version ${NEW_VERSION#v}"
git tag $NEW_VERSION
npm publish --access public --force
git push && git push --tags