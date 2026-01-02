// Configuration
const CORS_PROXY = 'https://corsproxy.io/?';

// Image settings (user-configurable)
let selectedFormat = 'webp';  // webp, jpg, png
let selectedBgColor = 'F4F4F4';  // hex color without #

// List of Nike marketplaces to search (in order of priority)
const MARKETPLACES = ['US', 'GB', 'EU', 'JP', 'CN', 'KR', 'AU', 'CA'];

// DOM Elements
const skuInput = document.getElementById('skuInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const productInfo = document.getElementById('productInfo');
const productName = document.getElementById('productName');
const productSubtitle = document.getElementById('productSubtitle');
const productPrice = document.getElementById('productPrice');
const productColorway = document.getElementById('productColorway');
const productSku = document.getElementById('productSku');
const imageCount = document.getElementById('imageCount');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const imageGallery = document.getElementById('imageGallery');
const customColorPicker = document.getElementById('customColor');

// State
let currentProduct = null;

// Event Listeners
searchBtn.addEventListener('click', handleSearch);
skuInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});
downloadAllBtn.addEventListener('click', handleDownloadAll);

// Format button listeners
document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedFormat = btn.dataset.format;
        // Refresh images if product is loaded
        if (currentProduct) {
            refreshImages();
        }
    });
});

// Color button listeners
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedBgColor = btn.dataset.color;
        // Refresh images if product is loaded
        if (currentProduct) {
            refreshImages();
        }
    });
});

// Custom color picker listener
customColorPicker.addEventListener('input', (e) => {
    // Remove # and convert to uppercase
    selectedBgColor = e.target.value.replace('#', '').toUpperCase();
    // Deselect preset buttons
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    // Refresh images if product is loaded
    if (currentProduct) {
        refreshImages();
    }
});

/**
 * Get the current transformation string based on selected options
 */
function getTransformString() {
    return `f_${selectedFormat},b_rgb:${selectedBgColor},q_80,h_2000,w_2000,c_pad,g_south,y_145`;
}

/**
 * Transform a Nike image URL to high-resolution format with current settings
 */
function transformToHighRes(imageUrl) {
    if (!imageUrl) return null;

    // Match Nike CDN URL patterns and replace transformation segment
    const transformRegex = /\/a\/images\/[^\/]+\//;
    if (transformRegex.test(imageUrl)) {
        let transformed = imageUrl.replace(transformRegex, `/a/images/${getTransformString()}/`);
        // Change extension based on selected format
        transformed = transformed.replace(/\.(png|jpg|jpeg|webp)(\?.*)?$/i, `.${selectedFormat}`);
        return transformed;
    }
    return imageUrl;
}

/**
 * Refresh images with current format/color settings
 */
function refreshImages() {
    if (!currentProduct || !currentProduct.rawImageUrls) return;

    // Re-transform all images with new settings
    currentProduct.images = currentProduct.rawImageUrls.map(url => transformToHighRes(url));

    // Re-render the gallery
    displayProduct(currentProduct);
}

/**
 * Handle search button click
 */
async function handleSearch() {
    const sku = skuInput.value.trim().toUpperCase();

    if (!sku) {
        showError('Please enter a SKU');
        return;
    }

    // Reset UI
    hideError();
    hideProductInfo();
    hideGallery();
    showLoading();

    try {
        const product = await fetchProductBySku(sku);
        hideLoading();

        if (!product) {
            showError('Product not found for SKU: ' + sku);
            return;
        }

        if (!product.images || product.images.length === 0) {
            showError('No images found for this SKU');
            return;
        }

        currentProduct = product;
        displayProduct(product);

    } catch (err) {
        hideLoading();
        showError('Failed to fetch product data. Please try again.');
        console.error(err);
    }
}

/**
 * Fetch product from Nike API using CORS proxy
 * Searches across multiple marketplaces to find products that may be region-specific
 */
async function fetchProductBySku(sku) {
    // Try each marketplace until we find the product
    for (const marketplace of MARKETPLACES) {
        const threadUrl = `https://api.nike.com/product_feed/threads/v3/?filter=language(en)&filter=marketplace(${marketplace})&filter=channelId(d9a5bc42-4b9c-4976-858a-f159cf99c647)&filter=productInfo.merchProduct.styleColor(${sku})`;

        try {
            const response = await fetch(CORS_PROXY + encodeURIComponent(threadUrl), {
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.objects && data.objects.length > 0) {
                    console.log(`Found product in ${marketplace} marketplace`);
                    const result = formatThreadResponse(data.objects[0], sku);
                    result.marketplace = marketplace;
                    return result;
                }
            }
        } catch (err) {
            console.log(`${marketplace} marketplace failed:`, err);
        }
    }

    // Fallback to search API
    return await searchBySku(sku);
}

/**
 * Search for product using Nike's browse API
 */
async function searchBySku(sku) {
    const searchUrl = `https://api.nike.com/cic/browse/v2?queryid=products&anonymousId=&country=us&endpoint=/product_feed/rollup_threads/v2?filter=marketplace(US)%26filter=language(en)%26filter=employeePrice(true)%26searchTerms=${sku}&language=en`;

    try {
        const response = await fetch(CORS_PROXY + encodeURIComponent(searchUrl), {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (!data.data?.products?.products?.length) {
            return null;
        }

        // Find exact match by styleColor
        const products = data.data.products.products;
        const exactMatch = products.find(p =>
            p.productCode === sku ||
            p.styleColor === sku ||
            (p.colorways && p.colorways.some(c => c.styleColor === sku))
        );

        const product = exactMatch || products[0];

        // Try to get detailed product info
        if (product.colorways && product.colorways.length > 0) {
            const colorway = product.colorways.find(c => c.styleColor === sku) || product.colorways[0];

            // Try thread API with the styleColor
            const styleColor = colorway.styleColor || product.styleColor;
            if (styleColor) {
                const detailedProduct = await fetchProductBySku(styleColor);
                if (detailedProduct && detailedProduct.images.length > 0) {
                    return detailedProduct;
                }
            }

            return formatProductResponse(product, colorway);
        }

        return formatProductResponse(product);

    } catch (err) {
        console.error('Search error:', err);
        return null;
    }
}

/**
 * Format thread API response
 */
function formatThreadResponse(thread, sku) {
    const productInfo = thread.productInfo?.[0] || {};
    const merchProduct = productInfo.merchProduct || {};
    const publishedContent = thread.publishedContent || {};

    // Extract all RAW images from published content
    const rawImages = [];

    // Get images from nodes (these are the high quality product shots)
    if (publishedContent.nodes) {
        extractImagesFromNodes(publishedContent.nodes, rawImages);
    }

    // Get images from productInfo imageUrls
    if (productInfo.imageUrls) {
        Object.values(productInfo.imageUrls).forEach(url => {
            if (url && typeof url === 'string') {
                rawImages.push(url);
            }
        });
    }

    // Dedupe raw images
    const uniqueRawImages = [...new Set(rawImages.filter(Boolean))];
    // Transform to current format/color settings
    const transformedImages = uniqueRawImages.map(url => transformToHighRes(url));

    return {
        success: true,
        sku: sku,
        name: merchProduct.labelName || publishedContent.properties?.title || 'Unknown Product',
        subtitle: merchProduct.subtitle || publishedContent.properties?.subtitle || '',
        price: formatPrice(merchProduct.price, merchProduct.currentPrice),
        colorway: merchProduct.colorDescription || '',
        styleColor: merchProduct.styleColor || sku,
        rawImageUrls: uniqueRawImages,  // Store raw URLs for re-transformation
        images: transformedImages
    };
}

/**
 * Recursively extract RAW images from node tree
 */
function extractImagesFromNodes(nodes, images) {
    if (!nodes || !Array.isArray(nodes)) return;

    nodes.forEach(node => {
        // Check for image URLs in properties - store RAW URLs
        if (node.properties) {
            if (node.properties.squarishURL) {
                images.push(node.properties.squarishURL);
            }
            if (node.properties.portraitURL) {
                images.push(node.properties.portraitURL);
            }
            if (node.properties.landscapeURL) {
                images.push(node.properties.landscapeURL);
            }
        }

        // Recursively check nested nodes
        if (node.nodes) {
            extractImagesFromNodes(node.nodes, images);
        }
    });
}

/**
 * Format basic product response
 */
function formatProductResponse(product, colorway = null) {
    const rawImages = [];

    // Get RAW images from product
    if (product.images?.squarishURL) {
        rawImages.push(product.images.squarishURL);
    }
    if (product.images?.portraitURL) {
        rawImages.push(product.images.portraitURL);
    }

    // Get colorway images
    if (colorway) {
        if (colorway.images?.squarishURL) {
            rawImages.push(colorway.images.squarishURL);
        }
        if (colorway.images?.portraitURL) {
            rawImages.push(colorway.images.portraitURL);
        }
    }

    // Get all colorway images
    if (product.colorways) {
        product.colorways.forEach(cw => {
            if (cw.images?.squarishURL) {
                rawImages.push(cw.images.squarishURL);
            }
        });
    }

    const uniqueRawImages = [...new Set(rawImages.filter(Boolean))];
    const transformedImages = uniqueRawImages.map(url => transformToHighRes(url));

    return {
        success: true,
        sku: colorway?.styleColor || product.styleColor || product.productCode || '',
        name: product.title || product.subtitle || 'Unknown Product',
        subtitle: product.subtitle || '',
        rawImageUrls: uniqueRawImages,  // Store raw URLs for re-transformation
        price: formatPrice(product.price, product.currentPrice),
        colorway: colorway?.colorDescription || product.colorDescription || '',
        styleColor: colorway?.styleColor || product.styleColor || '',
        images: uniqueImages
    };
}

/**
 * Format price display
 */
function formatPrice(listPrice, currentPrice) {
    if (currentPrice && listPrice && currentPrice !== listPrice) {
        return `$${currentPrice} (was $${listPrice})`;
    }
    return currentPrice ? `$${currentPrice}` : (listPrice ? `$${listPrice}` : 'Price unavailable');
}

/**
 * Display product information and images
 */
function displayProduct(product) {
    // Update product info
    productName.textContent = product.name;
    productSubtitle.textContent = product.subtitle || '';
    productPrice.textContent = product.price;
    productColorway.textContent = product.colorway || '';
    productSku.textContent = product.styleColor || product.sku;

    // Show marketplace if not US
    let countText = `${product.images.length} image${product.images.length !== 1 ? 's' : ''} found`;
    if (product.marketplace && product.marketplace !== 'US') {
        countText += ` (from ${product.marketplace} region)`;
    }
    imageCount.textContent = countText;

    // Hide empty elements
    productSubtitle.style.display = product.subtitle ? 'block' : 'none';
    productColorway.style.display = product.colorway ? 'inline' : 'none';

    // Build image gallery
    imageGallery.innerHTML = '';

    product.images.forEach((imageUrl, index) => {
        const card = createImageCard(imageUrl, index + 1, product.images.length);
        imageGallery.appendChild(card);
    });

    showProductInfo();
    showGallery();
}

/**
 * Create an image card element
 */
function createImageCard(imageUrl, number, total) {
    const card = document.createElement('div');
    card.className = 'image-card';

    // Use the selected format (uppercase for display)
    const format = selectedFormat.toUpperCase();

    // Truncate URL for display (show first 40 and last 20 chars)
    const displayUrl = imageUrl.length > 70
        ? imageUrl.substring(0, 40) + '...' + imageUrl.substring(imageUrl.length - 25)
        : imageUrl;

    card.innerHTML = `
        <div class="image-wrapper">
            <img src="${imageUrl}" alt="Product image ${number}" loading="lazy">
            <div class="image-overlay">
                <button class="btn-download" data-url="${imageUrl}" data-index="${number}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Download
                </button>
            </div>
        </div>
        <div class="image-info">
            <span class="image-number">Image ${number} of ${total}</span>
            <span class="image-format">${format} - 2000x2000</span>
        </div>
        <div class="image-url-container">
            <input type="text" class="image-url-input" value="${imageUrl}" readonly>
            <button class="btn-copy" data-url="${imageUrl}" title="Copy URL">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
        </div>
    `;

    // Add download event listener
    const downloadBtn = card.querySelector('.btn-download');
    downloadBtn.addEventListener('click', () => {
        downloadImage(imageUrl, number);
    });

    // Add copy event listener
    const copyBtn = card.querySelector('.btn-copy');
    copyBtn.addEventListener('click', () => {
        copyToClipboard(imageUrl, copyBtn);
    });

    return card;
}

/**
 * Copy text to clipboard and show feedback
 */
async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);

        // Visual feedback
        const originalHTML = button.innerHTML;
        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        button.classList.add('copied');

        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('copied');
        }, 1500);
    } catch (err) {
        console.error('Copy failed:', err);
        // Fallback: select the text
        const input = button.previousElementSibling;
        input.select();
        document.execCommand('copy');
    }
}

/**
 * Download a single image
 */
async function downloadImage(url, index) {
    try {
        // Use CORS proxy for downloading
        const response = await fetch(CORS_PROXY + encodeURIComponent(url));
        const blob = await response.blob();

        const extension = url.includes('.webp') ? 'webp' :
            url.includes('.png') ? 'png' : 'jpg';

        const filename = `${currentProduct.styleColor || currentProduct.sku}_${index}.${extension}`;

        saveAs(blob, filename);
    } catch (err) {
        console.error('Download failed:', err);
        // Fallback: open in new tab
        window.open(url, '_blank');
    }
}

/**
 * Download all images as ZIP
 */
async function handleDownloadAll() {
    if (!currentProduct || !currentProduct.images.length) return;

    const originalText = downloadAllBtn.innerHTML;
    downloadAllBtn.disabled = true;
    downloadAllBtn.innerHTML = `
        <div class="spinner" style="width: 16px; height: 16px; border-width: 2px; margin: 0;"></div>
        Creating ZIP...
    `;

    try {
        const zip = new JSZip();
        const folder = zip.folder(currentProduct.styleColor || currentProduct.sku);

        // Fetch all images
        const fetchPromises = currentProduct.images.map(async (url, index) => {
            try {
                const response = await fetch(CORS_PROXY + encodeURIComponent(url));
                const blob = await response.blob();

                const extension = url.includes('.webp') ? 'webp' :
                    url.includes('.png') ? 'png' : 'jpg';

                const filename = `${currentProduct.styleColor || currentProduct.sku}_${index + 1}.${extension}`;
                folder.file(filename, blob);
            } catch (err) {
                console.error(`Failed to fetch image ${index + 1}:`, err);
            }
        });

        await Promise.all(fetchPromises);

        // Generate and download ZIP
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `${currentProduct.styleColor || currentProduct.sku}_images.zip`);

    } catch (err) {
        console.error('ZIP creation failed:', err);
        showError('Failed to create ZIP file');
    } finally {
        downloadAllBtn.disabled = false;
        downloadAllBtn.innerHTML = originalText;
    }
}

// UI Helpers
function showLoading() {
    loading.classList.remove('hidden');
}

function hideLoading() {
    loading.classList.add('hidden');
}

function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
}

function hideError() {
    error.classList.add('hidden');
}

function showProductInfo() {
    productInfo.classList.remove('hidden');
}

function hideProductInfo() {
    productInfo.classList.add('hidden');
}

function showGallery() {
    imageGallery.classList.remove('hidden');
}

function hideGallery() {
    imageGallery.classList.add('hidden');
}
