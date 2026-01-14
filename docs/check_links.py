import re
import os

def check_markdown_links(file_path):
    broken_links = []
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex to find markdown links: [text](path)
    # Group 1 captures the path
    link_pattern = re.compile(r' \[.*? \] \(.*? \)')

    links = link_pattern.findall(content)

    for link in links:
        # Ignore external links (http, https, mailto, etc.)
        if re.match(r' ^(http|https|mailto|ftp|sftp)://', link):
            continue
        # Ignore anchor links within the same document
        if link.startswith('#'):
            continue
        # Ignore links that are just filenames without a path (e.g., "file.md")
        if '/' not in link and '\\' not in link:
            continue

        # Resolve relative path
        base_dir = os.path.dirname(file_path)
        resolved_path = os.path.join(base_dir, link)
        
        # Normalize path to handle ../ and ./
        resolved_path = os.path.normpath(resolved_path)

        if not os.path.exists(resolved_path):
            broken_links.append((link, resolved_path))
    
    return broken_links

if __name__ == "__main__":
    test_file = "/home/greggles/metahuman/docs/user-guide/10-security-trust.md"
    broken = check_markdown_links(test_file)
    if broken:
        print(f"Broken links in {test_file}:")
        for original_link, resolved_path in broken:
            print(f"  Original: {original_link}, Resolved: {resolved_path}")
    else:
        print(f"No broken links found in {test_file}")
