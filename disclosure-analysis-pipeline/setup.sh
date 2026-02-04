#!/bin/bash

echo "Setting up Financial Disclosure Analysis Pipeline..."

# Create virtual environment
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install dependencies
pip install -r requirements.txt

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and add your GOOGLE_API_KEY"
echo "2. Place your PDF files in the data/ folder"
echo "3. Run: python -m src.pipeline"
echo ""
echo "To activate the virtual environment later, run:"
echo "  source venv/bin/activate"
