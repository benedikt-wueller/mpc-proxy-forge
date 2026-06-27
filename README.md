# MPC Proxy Forge

MPC Proxy Forge is an interactive automation tool to convert one or more [Moxfield](https://moxfield.com) decks into ready-to-print files for [MPC Autofill](https://github.com/chilli-axe/mpc-autofill) by downloading the exact prints selected from [Scryfall](https://scryfall.com), running post-processing and (optional) local upscaling using [Upscayl](https://github.com/upscayl/upscayl-ncnn).

## Motivation

My friends and I enjoy building Magic: The Gathering decks on Moxfield and we regularly order those as proxies for tabletop play via MPC Autofill. However, we found the process of going through the MPC Autofill database, finding a print we like, making sure it's the right language and doesn't use AI generated artworks to be very tedious, especially for larger orders of multiple decks. Instead, we prefer to just use proxies of the prints already selected in Moxfield during deck building. That's what this tool aims to achieve.

## How it works

After configuring how the Scryfall cards should be processed and selecting which decks to prepare for ordering, the tool runs through the following steps:
1. Load the moxfield deck details
2. Download the Scryfall images for the exact prints selected in the Moxfield deck
3. Cleanup card corners and borders
4. Add bleed edge for card cutting
5. (optional) Replace copyright notice with `Proxy - Not For Sale` notice
6. (optional) Upscale the images to target DPI (800 by default)
7. Create `cards.xml` file for MPC Autofill processing

MPC Autofill will load the processed card images from the `cards` directory next to the generated `cards.xml` file.

## Examples

> [!NOTE]
> The quality of the processed and upscaled images will vary based on the the quality of the original Scryfall scans, the cards artwork and the upscaling model used. When building your deck in Moxfield, make sure to select printings that have a good base resolution and adequate quality overall.

TODO

---

# Usage

TODO

# Installation

## Releases

1. Download the latest release from the [Releases tab](https://github.com/benedikt-wueller/mpc-proxy-forge/releases)
2. Unzip the archive and double-click the `mpc-proxy-forge.cmd` or `mpc-proxy-forge` executable

> [!IMPORTANT]
> As the executables are not signed, you may get a warning from your operating system.

> [!NOTE]
> On macOS, you will be prevented from running the application on first startup.  
> Navigate to **System Preferences** > **Privacy & Security** and press **Open Anyway**.

## Building from Source

If you want to modify the code or build the CLI executables yourself, follow these steps.

**Prerequisites:**
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* Git

**Setup Instructions:**

1. Clone the repository and navigate into the directory:
   ```bash
   git clone https://github.com/benedikt-wueller/mpc-proxy-forge.git
   cd mpc-proxy-forge
   ```
2. Install the required dependencies:
   ```bash
   npm install
   ```
4. Run the tool in development mode:
   ```bash
   npm run dev
   ```
5. Compile to JavaScript:
   ```bash
   npm run build
   ```

# Contribution

Feel free to create issues for any bugs you encounter or features you'd like to be added.

I may not have the time to implement all the features requested but I invite anyone (that is a real person) to create pull requests to add them.
There really are no strict coding guidelines as I am relatively new to typescript myself. Just try to keep the overall style consistent across the project.

# Disclaimer

MPC Proxy Forge is an unofficial, fan-made project and is not affiliated with, endorsed, sponsored, or specifically approved by Wizards of the Coast LLC. Magic: The Gathering is a trademark of Wizards of the Coast.

By using this software, you acknowledge and agree to the following:
- Intellectual Property: All card images, text, and associated artwork are the copyrighted property of Wizards of the Coast. This tool is designed strictly for creating personal, non-commercial proxies for private tabletop play.
- User Responsibility: You are solely responsible for how you use the generated image files. The creator(s) of MPC Proxy Forge do not condone the sale or distribution of counterfeit cards.
- Image Modification: The automated modification of copyright text is done solely to comply with the printing policies of third-party manufacturers (e.g., MakePlayingCards.com). You assume all legal risks associated with modifying and printing these copyrighted works.
- No Warranty ("AS IS"): This software is provided "as is", without warranty of any kind. The author(s) assume no liability for refused printing orders, suspended manufacturer accounts, copyright disputes, or any other legal or financial consequences resulting from the use of this tool.
