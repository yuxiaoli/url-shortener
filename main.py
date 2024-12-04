import argparse
import pyshorteners

def shorten(url):
    return pyshorteners.Shortener().tinyurl.short(url)
    # return pyshorteners.Shortener().clckru.short(url)
    # return pyshorteners.Shortener().dagd.short(url)

def main():
    parser = argparse.ArgumentParser(description="Shorten a given URL using TinyURL.")
    parser.add_argument("url", type=str, help="The URL to be shortened.")
    args = parser.parse_args()

    short_url = shorten(args.url)
    print(f"Shortened URL: {short_url}")

if __name__ == "__main__":
    main()
