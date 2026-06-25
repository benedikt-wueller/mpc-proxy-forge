# MPC Proxy Forge

An interactive command line tool to convert Moxfield deck lists into
ready-to-print [MPC Autofill](https://github.com/chilli-axe/mpc-autofill) files, downloading the exact prints
from [Scryfall](https://scryfall.com/) or [Cardgourmet](https://cardgourmet.com/) and post-processing them to to
improve MPC printing quality.

The images are post-processed to make them ready for printing. Processing steps include:
- Filling card corners and fixing borders
- Removing the copyright notice and adding a proxy indicator
- Removing holographic stamps
- Adding a bleed area for printing
- Local upscaling to the desired DPI using [upscayl](https://github.com/upscayl/)

// TODO: add examples

## Motivation

Though I am a big fan of [MPC Autofill](https://github.com/chilli-axe/mpc-autofill) and think it is a great tool to
create and order MTG proxies, I found it to be a bit too tedious to use, especially with big orders. I don't like
manually browsing through all the possible prints for each card, making sure the language matches the one I want and 
ensuring the artwork is not AI-generated. I prefer using prints that are as close to the actual card as possible without
jumping through hoops.

My goal was to enable a more intuitive workflow where I can simply select the exact prints I want in my moxfield deck
lists and end up with a ready-to-print MPC Autofill file containing everything I need.

## Usage

### Installation

// TODO

#### Binaries

// TODO

#### From source

// TODO

### Processing Profiles

// TODO

### Preparing MPC Autofill Order

// TODO