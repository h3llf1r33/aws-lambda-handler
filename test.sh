for tag in $(git tag | grep -v -E '^2\.0\.0$'); do
    git tag -d "$tag"
done

