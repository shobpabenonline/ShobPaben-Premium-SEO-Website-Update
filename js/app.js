/* ==========================================================================
   ShobPaben.online — js/app.js
   Vanilla JavaScript storefront logic for ShobPaben.online.

   Written against the supplied index.html + styles.css. The storefront keeps
   its existing structure and sends checkout orders to the configured Google
   Apps Script endpoint, which appends them to the private Google Sheet.

   IMPORTANT:
   • The checkout endpoint URL is present below, but its deployment and sheet write
     have not been verified. The matching Code.gs and sheet setup are required.
   • Orders are treated as submitted only after the endpoint confirms the exact
     Order ID exists in the sheet. This is a manual-order workflow, not a payment gateway.
   • Product catalogue, delivery fees, coupons, and prices are browser-provided;
     verify business values and add trusted server-side validation before launch.

   Sections
    1.  Configuration (edit delivery, coupons, limits, WhatsApp, texts)
    2.  Product catalogue — 350 slots (EDIT PRODUCTS HERE)
    3.  Helpers, storage, notifications, image fallback
    4.  State & DOM references
    5.  Product rendering
    6.  Router / page views / category navigation
    7.  Header menu
    8.  Search & autocomplete
    9.  Hero carousel
   10.  Category listing: filters, sorting, load more
   11.  Product details & quick view
   12.  Shopping cart (+ coupons & totals)
   13.  Wishlist
   14.  Checkout & validation
   15.  Order confirmation, invoice & order history
   16.  WhatsApp integration, contact & newsletter
   17.  Event wiring
   18.  Initialisation
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     1. CONFIGURATION
     ====================================================================== */

  const CONFIG = {
    storagePrefix: 'shobpaben:v1:',     // bump "v1" if you change the stored data shape
    whatsappNumber: '8801355514101',    // international format, digits only (+880 1355-514101)
    currencySymbol: '৳',

    // Text shown in the announcement bar. Leave '' to keep the text written in index.html.
    announcement: { enabled: true, message: 'Explore our latest offers.' },

    // Flash-deal countdown. Use an ISO date such as '2026-12-31T23:59:59+06:00'.
    // Leave '' (empty) and NO countdown is shown — no fake deadline is invented.
    // (You may alternatively fill data-end-time="" on #flash-deals-timer in the HTML.)
    flashDealEndTime: '',

    pageSize: 70,                       // products shown per "Load More" step on listing pages
    home: { flashDeals: 5, newArrivals: 10, bestSellers: 10, perCategory: 5 },
    relatedProducts: 4,
    lowStockThreshold: 5,               // "Only N left" is shown at or below this stock
    maxQuantityPerLine: 99,             // hard ceiling per product, in addition to stock
    suggestionLimit: 6,
    searchDebounceMs: 120,
    autoplayMs: 5000,                   // hero carousel interval
    toastMs: 3600,

    orderIdPrefix: 'SP',                // order IDs submitted to ShobPaben Orders
    persistOrderHistory: true,          // keeps demo orders (incl. name/phone/address) in this browser only
    maxStoredOrders: 20
  };

  // DEMO delivery rules (BDT). Replace with your real delivery charges.
  const DELIVERY = {
    insideDhakaDistrict: 'dhaka',       // district value treated as "inside Dhaka"
    insideDhakaFee: 60,
    outsideDhakaFee: 120,
    freeDeliveryMinSubtotal: 0,         // 0 = disabled. Example: 3000 gives free delivery from ৳3,000
    showSampleRateNotice: true          // appends "(sample rates)" to delivery text; set false once rates are real
  };

  // TEST coupons for demonstration only — not real promotions.
  const COUPONS = {
    TEST10:  { type: 'percent', value: 10,  minSubtotal: 500,  maxDiscount: 300 }, // TEST: 10% off, min ৳500, max ৳300
    TEST100: { type: 'fixed',   value: 100, minSubtotal: 1000 }                    // TEST: ৳100 off, min ৳1,000
  };

  const TEXT = {
    returnPolicy: 'Please read our Return & Refund Policy before ordering. For a return request, contact support on WhatsApp.'
  };

  const KEYS = {
    cart: CONFIG.storagePrefix + 'cart',
    wishlist: CONFIG.storagePrefix + 'wishlist',
    orders: CONFIG.storagePrefix + 'orders',
    pendingOrder: CONFIG.storagePrefix + 'pendingOrder',
    announcementClosed: CONFIG.storagePrefix + 'announcementClosed',
    language: CONFIG.storagePrefix + 'language'
  };

  const PLACEHOLDER_IMAGE = 'assets/images/products/placeholder-product.jpg';
  const FALLBACK_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#EFE8D6"/>' +
    '<g fill="none" stroke="#287A74" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".55">' +
    '<rect x="130" y="140" width="140" height="120" rx="14"/><circle cx="170" cy="180" r="12"/>' +
    '<path d="m140 250 45-45 35 30 25-20 25 35"/></g></svg>'
  );

  const CATEGORIES = [
    { id: 'electronics',  name: 'Electronics & Gadgets',  description: 'Smart devices, accessories and everyday gadgets.' },
    { id: 'home-kitchen', name: 'Home & Kitchen',         description: 'Cookware, storage and useful household items.' },
    { id: 'beauty',       name: 'Beauty & Personal Care', description: 'Skincare, grooming and personal care essentials.' },
    { id: 'fashion',      name: 'Games & Toys',           description: 'Board games, puzzles and creative toys for every age.' },
    { id: 'baby-kids',    name: 'Baby & Kids',            description: 'Everyday products for babies, toddlers and children.' }
  ];

  // Extra listing views reachable with data-action="open-category".
  const COLLECTIONS = {
    'all':          { name: 'All Products',  description: 'Every published product in one list.' },
    'flash-deals':  { name: 'Flash Deals',   description: 'Limited-time offers on selected products.' },
    'all-deals':    { name: 'All Deals',     description: 'Products with an offer or a reduced price.' },
    'new-arrivals': { name: 'New Arrivals',  description: 'Recently added products.' },
    'best-sellers': { name: 'Best Sellers',  description: 'Products marked as best sellers.' }
  };

  // Bangladesh divisions → districts (checkout form).
  const DIVISION_DISTRICTS = {
    barishal:   ['Barguna', 'Barishal', 'Bhola', 'Jhalokathi', 'Patuakhali', 'Pirojpur'],
    chattogram: ['Bandarban', 'Brahmanbaria', 'Chandpur', 'Chattogram', 'Cumilla', "Cox's Bazar", 'Feni', 'Khagrachhari', 'Lakshmipur', 'Noakhali', 'Rangamati'],
    dhaka:      ['Dhaka', 'Faridpur', 'Gazipur', 'Gopalganj', 'Kishoreganj', 'Madaripur', 'Manikganj', 'Munshiganj', 'Narayanganj', 'Narsingdi', 'Rajbari', 'Shariatpur', 'Tangail'],
    khulna:     ['Bagerhat', 'Chuadanga', 'Jashore', 'Jhenaidah', 'Khulna', 'Kushtia', 'Magura', 'Meherpur', 'Narail', 'Satkhira'],
    mymensingh: ['Jamalpur', 'Mymensingh', 'Netrokona', 'Sherpur'],
    rajshahi:   ['Bogura', 'Joypurhat', 'Naogaon', 'Natore', 'Chapainawabganj', 'Pabna', 'Rajshahi', 'Sirajganj'],
    rangpur:    ['Dinajpur', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Nilphamari', 'Panchagarh', 'Rangpur', 'Thakurgaon'],
    sylhet:     ['Habiganj', 'Moulvibazar', 'Sunamganj', 'Sylhet']
  };

  // Route names → existing page-view IDs (route path is "#/<name>").
  const PAGE_ROUTES = {
    cart: 'cart-page',
    checkout: 'checkout-page',
    wishlist: 'wishlist-page',
    account: 'account-page',
    orders: 'order-history-page',
    about: 'about-page',
    contact: 'contact-page',
    'order-confirmation': 'order-confirmation-page'
  };

  /* ======================================================================
     2. BEGINNER-FRIENDLY PRODUCT MANAGEMENT — EDIT PRODUCTS HERE
     ----------------------------------------------------------------------
     বাংলা: প্রতিটি category-এর array-তে একটি object যোগ/সম্পাদনা করলেই পণ্য
     পরিচালনা হবে। id অপরিবর্তিত রাখুন; নতুন পণ্যে পরের ফাঁকা ID ব্যবহার করুন।

     Image convention: assets/images/products/<product-id>.jpg
     যেমন electronics-031.jpg। এই .jpg default path; ফাইল না থাকলে existing
     placeholder/fallback দেখাবে। অন্য extension বা filename হলে image-এ
     পুরো root-relative path লিখুন। একাধিক ছবি চাইলে images array দিন।

     price = বিক্রয়মূল্য; originalPrice = আগের মূল্য অথবা null। valid discount
     হলে badge স্বয়ংক্রিয়ভাবে হিসাব হয়। stock শূন্য হলে পণ্য sold out-ই থাকবে।
     published:false করলে পণ্যটি storefront-এ দেখা যাবে না। অনুপস্থিত slot-গুলো
     unpublished থাকবে। নিচের বিদ্যমান sample/demo তথ্য source ফাইল থেকে রাখা হয়েছে;
     এগুলোকে যাচাইকৃত বাস্তব ব্যবসায়িক তথ্য ধরে নেবেন না।
     ====================================================================== */

  const PRODUCT_CATALOGUE = {
    // Electronics & Gadgets — existing product IDs and data
    'electronics': [
      {
        "id": "electronics-001",
        "image": "assets/images/products/electronics-001.jpg",
        "name": "True Wireless Earbuds",
        "price": 1490,
        "originalPrice": 1990,
        "stock": 40,
        "description": "Compact Bluetooth earbuds with a charging case for daily listening.",
        "published": true,
        "isFlashDeal": true,
        "isNewArrival": true,
        "isFeatured": true,
        "specs": {
          "Connectivity": "Bluetooth",
          "Included": "Charging case, USB cable"
        }
      },
      {
        "id": "electronics-002",
        "image": "assets/images/products/electronics-002.jpg",
        "name": "Bluetooth Neckband Headphones",
        "price": 990,
        "originalPrice": 1290,
        "stock": 60,
        "description": "Lightweight wireless neckband for calls and music.",
        "published": true
      },
      {
        "id": "electronics-003",
        "name": "20000mAh Power Bank",
        "price": 2150,
        "originalPrice": 2590,
        "stock": 35,
        "description": "High-capacity portable charger for phones and small devices.",
        "published": true,
        "isFlashDeal": true,
        "isFeatured": true,
        "specs": {
          "Capacity": "20000mAh"
        }
      },
      {
        "id": "electronics-004",
        "name": "20W Fast Charging Adapter",
        "price": 690,
        "originalPrice": null,
        "stock": 80,
        "description": "Wall adapter for compatible fast-charging phones.",
        "published": true
      },
      {
        "id": "electronics-005",
        "name": "USB-C Charging Cable (1m)",
        "price": 290,
        "originalPrice": 390,
        "stock": 150,
        "description": "Durable braided USB-C cable for charging and data transfer.",
        "published": true
      },
      {
        "id": "electronics-006",
        "name": "Smart Fitness Band",
        "price": 2490,
        "originalPrice": 2990,
        "stock": 30,
        "description": "Activity band with step counting and heart-rate display.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "electronics-007",
        "name": "Portable Bluetooth Speaker",
        "price": 1890,
        "originalPrice": null,
        "stock": 25,
        "description": "Pocket-size wireless speaker for home and outdoor use.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "electronics-008",
        "name": "Wireless Optical Mouse",
        "price": 790,
        "originalPrice": 950,
        "stock": 70,
        "description": "Quiet-click wireless mouse for work and study.",
        "published": true
      },
      {
        "id": "electronics-009",
        "name": "RGB Gaming Keyboard",
        "price": 2950,
        "originalPrice": 3490,
        "stock": 18,
        "description": "Backlit keyboard with a comfortable full-size layout.",
        "published": true
      },
      {
        "id": "electronics-010",
        "name": "Full HD Webcam",
        "price": 1850,
        "originalPrice": null,
        "stock": 22,
        "description": "1080p webcam with built-in microphone for video calls.",
        "published": true
      },
      {
        "id": "electronics-011",
        "name": "64GB USB Flash Drive",
        "price": 650,
        "originalPrice": 790,
        "stock": 90,
        "description": "Portable storage for documents, photos and files.",
        "published": true
      },
      {
        "id": "electronics-012",
        "name": "128GB microSD Memory Card",
        "price": 1250,
        "originalPrice": 1490,
        "stock": 55,
        "description": "Memory card for phones, cameras and action cameras.",
        "published": true
      },
      {
        "id": "electronics-013",
        "name": "Flexible Phone Tripod Stand",
        "price": 590,
        "originalPrice": null,
        "stock": 65,
        "description": "Adjustable tripod for photos, videos and video calls.",
        "published": true
      },
      {
        "id": "electronics-014",
        "name": "10-inch LED Ring Light",
        "price": 1150,
        "originalPrice": 1450,
        "stock": 28,
        "description": "Dimmable ring light with stand for content creation.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "electronics-015",
        "name": "Aluminium Laptop Stand",
        "price": 1350,
        "originalPrice": null,
        "stock": 33,
        "description": "Foldable stand that raises your laptop to a comfortable height.",
        "published": true
      },
      {
        "id": "electronics-016",
        "name": "4-Port USB Hub",
        "price": 790,
        "originalPrice": null,
        "stock": 48,
        "description": "Expand your laptop with four extra USB ports.",
        "published": true
      },
      {
        "id": "electronics-017",
        "name": "Wireless Charging Pad",
        "price": 1190,
        "originalPrice": 1490,
        "stock": 26,
        "description": "Flat charging pad for compatible wireless-charging phones.",
        "published": true
      },
      {
        "id": "electronics-018",
        "name": "Wi-Fi Smart LED Bulb",
        "price": 650,
        "originalPrice": null,
        "stock": 45,
        "description": "Colour-changing smart bulb controlled from your phone.",
        "published": true
      },
      {
        "id": "electronics-019",
        "name": "Rechargeable Mini Fan",
        "price": 890,
        "originalPrice": 1090,
        "stock": 50,
        "description": "Handheld fan with a rechargeable battery.",
        "published": true,
        "isFlashDeal": true
      },
      {
        "id": "electronics-020",
        "name": "Car Phone Holder",
        "price": 450,
        "originalPrice": null,
        "stock": 75,
        "description": "Dashboard and vent-mount phone holder for the car.",
        "published": true
      },
      {
        "id": "electronics-021",
        "name": "HDMI Cable (1.5m)",
        "price": 390,
        "originalPrice": null,
        "stock": 100,
        "description": "HDMI cable for TVs, monitors and projectors.",
        "published": true
      },
      {
        "id": "electronics-022",
        "name": "Laptop Cooling Pad",
        "price": 1490,
        "originalPrice": 1790,
        "stock": 0,
        "description": "Cooling pad with built-in fans for laptops.",
        "published": true
      },
      {
        "id": "electronics-023",
        "name": "Slim Bluetooth Keyboard",
        "price": 1590,
        "originalPrice": null,
        "stock": 24,
        "description": "Portable wireless keyboard for tablets and phones.",
        "published": true
      },
      {
        "id": "electronics-024",
        "name": "Smart Watch with Calling",
        "price": 3990,
        "originalPrice": 4590,
        "stock": 15,
        "description": "Smart watch with Bluetooth calling and notifications.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "electronics-025",
        "name": "Wired Earphones with Mic",
        "price": 350,
        "originalPrice": null,
        "stock": 120,
        "description": "Wired in-ear earphones with an inline microphone.",
        "published": true
      },
      {
        "id": "electronics-026",
        "name": "2.5-inch External HDD Case",
        "price": 690,
        "originalPrice": null,
        "stock": 38,
        "description": "USB enclosure for a 2.5-inch laptop hard drive.",
        "published": true
      },
      {
        "id": "electronics-027",
        "name": "Tempered Glass Screen Protector",
        "price": 250,
        "originalPrice": null,
        "stock": 200,
        "description": "Scratch-resistant screen protector for phones.",
        "published": true
      },
      {
        "id": "electronics-028",
        "name": "Rechargeable LED Desk Lamp",
        "price": 1090,
        "originalPrice": 1350,
        "stock": 30,
        "description": "Dimmable desk lamp with a rechargeable battery.",
        "published": true
      },
      {
        "id": "electronics-029",
        "name": "Digital Alarm Clock",
        "price": 790,
        "originalPrice": null,
        "stock": 40,
        "description": "LED alarm clock with date and temperature display.",
        "published": true
      },
      {
        "id": "electronics-030",
        "name": "Universal Travel Adapter",
        "price": 950,
        "originalPrice": null,
        "stock": 42,
        "description": "Multi-plug travel adapter for use abroad.",
        "published": true
      },
      // SAMPLE DATA: Added records below are illustrative, not verified business facts.
      // Owner must verify names, prices, stock and descriptions before real sales.
      // Images use existing <product-id>.jpg paths and fallback; no image files were created.
      {
        "id": "electronics-031",
        "name": "USB-C Card Reader",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "USB-C Card Reader for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-032",
        "name": "Laptop Privacy Cover",
        "price": 150,
        "originalPrice": null,
        "stock": 30,
        "description": "Laptop Privacy Cover for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-033",
        "name": "Phone Camera Lens Kit",
        "price": 790,
        "originalPrice": null,
        "stock": 35,
        "description": "Phone Camera Lens Kit for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-034",
        "name": "Desktop Microphone",
        "price": 1490,
        "originalPrice": null,
        "stock": 40,
        "description": "Desktop Microphone for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-035",
        "name": "USB Desk Fan",
        "price": 650,
        "originalPrice": null,
        "stock": 20,
        "description": "USB Desk Fan for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-036",
        "name": "Cable Organizer Clips",
        "price": 190,
        "originalPrice": null,
        "stock": 25,
        "description": "Cable Organizer Clips for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-037",
        "name": "Ethernet Cable",
        "price": 350,
        "originalPrice": null,
        "stock": 30,
        "description": "Ethernet Cable for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-038",
        "name": "Portable SSD Enclosure",
        "price": 1290,
        "originalPrice": null,
        "stock": 35,
        "description": "Portable SSD Enclosure for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-039",
        "name": "Tablet Display Stand",
        "price": 550,
        "originalPrice": null,
        "stock": 40,
        "description": "Tablet Display Stand for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-040",
        "name": "Digital Kitchen Timer",
        "price": 390,
        "originalPrice": null,
        "stock": 20,
        "description": "Digital Kitchen Timer for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-041",
        "name": "Bluetooth Audio Receiver",
        "price": 750,
        "originalPrice": null,
        "stock": 25,
        "description": "Bluetooth Audio Receiver for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-042",
        "name": "USB-C to HDMI Adapter",
        "price": 1190,
        "originalPrice": null,
        "stock": 30,
        "description": "USB-C to HDMI Adapter for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-043",
        "name": "Laptop Sleeve",
        "price": 790,
        "originalPrice": null,
        "stock": 35,
        "description": "Laptop Sleeve for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-044",
        "name": "Monitor Riser",
        "price": 990,
        "originalPrice": null,
        "stock": 40,
        "description": "Monitor Riser for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-045",
        "name": "Phone Finger Grip",
        "price": 180,
        "originalPrice": null,
        "stock": 20,
        "description": "Phone Finger Grip for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-046",
        "name": "Rechargeable Book Light",
        "price": 490,
        "originalPrice": null,
        "stock": 25,
        "description": "Rechargeable Book Light for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-047",
        "name": "Gaming Mouse Pad",
        "price": 590,
        "originalPrice": null,
        "stock": 30,
        "description": "Gaming Mouse Pad for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-048",
        "name": "USB Extension Cable",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "USB Extension Cable for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-049",
        "name": "Desktop Cable Management Box",
        "price": 650,
        "originalPrice": null,
        "stock": 40,
        "description": "Desktop Cable Management Box for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-050",
        "name": "Smart Plug",
        "price": 990,
        "originalPrice": null,
        "stock": 20,
        "description": "Smart Plug for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-051",
        "name": "Portable FM Radio",
        "price": 850,
        "originalPrice": null,
        "stock": 25,
        "description": "Portable FM Radio for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-052",
        "name": "Digital Voice Recorder",
        "price": 2490,
        "originalPrice": null,
        "stock": 30,
        "description": "Digital Voice Recorder for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-053",
        "name": "Mini Projector Stand",
        "price": 890,
        "originalPrice": null,
        "stock": 35,
        "description": "Mini Projector Stand for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-054",
        "name": "Microphone Pop Filter",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Microphone Pop Filter for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-055",
        "name": "Headphone Storage Stand",
        "price": 590,
        "originalPrice": null,
        "stock": 20,
        "description": "Headphone Storage Stand for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-056",
        "name": "USB-C Earphone Adapter",
        "price": 350,
        "originalPrice": null,
        "stock": 25,
        "description": "USB-C Earphone Adapter for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-057",
        "name": "Screen Cleaning Kit",
        "price": 250,
        "originalPrice": null,
        "stock": 30,
        "description": "Screen Cleaning Kit for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-058",
        "name": "Rechargeable Bike Light",
        "price": 690,
        "originalPrice": null,
        "stock": 35,
        "description": "Rechargeable Bike Light for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-059",
        "name": "Phone Waterproof Pouch",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Phone Waterproof Pouch for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-060",
        "name": "Laptop Keyboard Cover",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Laptop Keyboard Cover for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-061",
        "name": "Webcam Privacy Shutter Set",
        "price": 120,
        "originalPrice": null,
        "stock": 25,
        "description": "Webcam Privacy Shutter Set for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-062",
        "name": "USB Reading Light",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "USB Reading Light for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-063",
        "name": "Portable Keyboard Carry Case",
        "price": 650,
        "originalPrice": null,
        "stock": 35,
        "description": "Portable Keyboard Carry Case for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-064",
        "name": "Memory Card Storage Case",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Memory Card Storage Case for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-065",
        "name": "Audio Splitter Cable",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Audio Splitter Cable for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-066",
        "name": "USB Cable Tester",
        "price": 790,
        "originalPrice": null,
        "stock": 25,
        "description": "USB Cable Tester for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-067",
        "name": "Rechargeable Motion Sensor Light",
        "price": 890,
        "originalPrice": null,
        "stock": 30,
        "description": "Rechargeable Motion Sensor Light for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-068",
        "name": "Digital Luggage Scale",
        "price": 550,
        "originalPrice": null,
        "stock": 35,
        "description": "Digital Luggage Scale for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-069",
        "name": "Phone Charging Dock",
        "price": 750,
        "originalPrice": null,
        "stock": 40,
        "description": "Phone Charging Dock for everyday device use and organization.",
        "published": true
      },
      {
        "id": "electronics-070",
        "name": "Mini Desktop Vacuum",
        "price": 690,
        "originalPrice": null,
        "stock": 20,
        "description": "Mini Desktop Vacuum for everyday device use and organization.",
        "published": true
      }
    ],
    // Home & Kitchen — existing product IDs and data
    'home-kitchen': [
      {
        "id": "home-kitchen-001",
        "name": "Non-Stick Frying Pan (28 cm)",
        "price": 1250,
        "originalPrice": 1590,
        "stock": 40,
        "description": "Everyday frying pan with a non-stick coating.",
        "published": true,
        "isFlashDeal": true,
        "isFeatured": true
      },
      {
        "id": "home-kitchen-002",
        "name": "Pressure Cooker (5 L)",
        "price": 3490,
        "originalPrice": 3990,
        "stock": 14,
        "description": "Stainless steel pressure cooker for quick family meals.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "home-kitchen-003",
        "name": "Electric Kettle (1.8 L)",
        "price": 1390,
        "originalPrice": 1690,
        "stock": 32,
        "description": "Fast-boil kettle with auto shut-off.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "home-kitchen-004",
        "name": "Rice Storage Container (10 kg)",
        "price": 890,
        "originalPrice": null,
        "stock": 25,
        "description": "Airtight container to keep rice and grains fresh.",
        "published": true
      },
      {
        "id": "home-kitchen-005",
        "name": "Glass Food Container Set (3 pcs)",
        "price": 1190,
        "originalPrice": 1450,
        "stock": 36,
        "description": "Microwave-safe glass containers with lids.",
        "published": true
      },
      {
        "id": "home-kitchen-006",
        "name": "Wooden Cutting Board",
        "price": 550,
        "originalPrice": null,
        "stock": 60,
        "description": "Solid wooden board for slicing vegetables and fruit.",
        "published": true
      },
      {
        "id": "home-kitchen-007",
        "name": "Kitchen Knife Set (6 pcs)",
        "price": 1650,
        "originalPrice": 1950,
        "stock": 28,
        "description": "Stainless steel knife set with block.",
        "published": true
      },
      {
        "id": "home-kitchen-008",
        "name": "Spice Rack Organizer",
        "price": 790,
        "originalPrice": null,
        "stock": 34,
        "description": "Tiered rack to keep spices easy to reach.",
        "published": true
      },
      {
        "id": "home-kitchen-009",
        "name": "Stainless Steel Water Bottle (750 ml)",
        "price": 690,
        "originalPrice": 850,
        "stock": 80,
        "description": "Reusable bottle for school, office and travel.",
        "published": true,
        "isFlashDeal": true
      },
      {
        "id": "home-kitchen-010",
        "name": "Vacuum Flask (1 L)",
        "price": 1450,
        "originalPrice": null,
        "stock": 29,
        "description": "Insulated flask for hot or cold drinks.",
        "published": true
      },
      {
        "id": "home-kitchen-011",
        "name": "Dinner Set (24 pcs)",
        "price": 4950,
        "originalPrice": 5790,
        "stock": 10,
        "description": "Melamine dinner set for family meals.",
        "published": true
      },
      {
        "id": "home-kitchen-012",
        "name": "Microfiber Cleaning Cloths (6 pcs)",
        "price": 350,
        "originalPrice": null,
        "stock": 110,
        "description": "Soft reusable cloths for kitchen and home cleaning.",
        "published": true
      },
      {
        "id": "home-kitchen-013",
        "name": "Spin Mop with Bucket",
        "price": 2250,
        "originalPrice": 2690,
        "stock": 17,
        "description": "Mop and bucket set with spin wringer.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "home-kitchen-014",
        "name": "Foldable Laundry Basket",
        "price": 590,
        "originalPrice": null,
        "stock": 44,
        "description": "Collapsible basket that stores flat.",
        "published": true
      },
      {
        "id": "home-kitchen-015",
        "name": "Cotton Bed Sheet (Double)",
        "price": 1650,
        "originalPrice": 1990,
        "stock": 30,
        "description": "Soft cotton bed sheet with two pillow covers.",
        "published": true,
        "variants": [
          {
            "name": "Colour",
            "options": [
              "Blue",
              "Grey",
              "Cream"
            ]
          }
        ]
      },
      {
        "id": "home-kitchen-016",
        "name": "Pillow Set (2 pcs)",
        "price": 1290,
        "originalPrice": null,
        "stock": 40,
        "description": "Soft fibre-filled pillows for comfortable sleep.",
        "published": true
      },
      {
        "id": "home-kitchen-017",
        "name": "Cotton Bath Towel",
        "price": 690,
        "originalPrice": 850,
        "stock": 55,
        "description": "Absorbent cotton towel for daily use.",
        "published": true,
        "variants": [
          {
            "name": "Colour",
            "options": [
              "White",
              "Blue",
              "Grey"
            ]
          }
        ]
      },
      {
        "id": "home-kitchen-018",
        "name": "Wall Clock (12-inch)",
        "price": 750,
        "originalPrice": null,
        "stock": 26,
        "description": "Silent-sweep round wall clock.",
        "published": true
      },
      {
        "id": "home-kitchen-019",
        "name": "Storage Box Set (3 pcs)",
        "price": 990,
        "originalPrice": 1190,
        "stock": 38,
        "description": "Stackable storage boxes with lids.",
        "published": true
      },
      {
        "id": "home-kitchen-020",
        "name": "Clothes Hanger Set (12 pcs)",
        "price": 450,
        "originalPrice": null,
        "stock": 90,
        "description": "Sturdy non-slip hangers for wardrobes.",
        "published": true
      },
      {
        "id": "home-kitchen-021",
        "name": "Dish Drying Rack",
        "price": 1150,
        "originalPrice": null,
        "stock": 21,
        "description": "Two-tier rack with a drip tray.",
        "published": true
      },
      {
        "id": "home-kitchen-022",
        "name": "Blender (1.5 L)",
        "price": 3250,
        "originalPrice": 3790,
        "stock": 16,
        "description": "Countertop blender for smoothies and sauces.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "home-kitchen-023",
        "name": "Electric Rice Cooker (1.8 L)",
        "price": 3950,
        "originalPrice": 4450,
        "stock": 12,
        "description": "Automatic rice cooker with keep-warm function.",
        "published": true
      },
      {
        "id": "home-kitchen-024",
        "name": "Airtight Jar Set (6 pcs)",
        "price": 850,
        "originalPrice": null,
        "stock": 47,
        "description": "Clear jars for pulses, spices and snacks.",
        "published": true
      },
      {
        "id": "home-kitchen-025",
        "name": "Tea Cup Set (6 pcs)",
        "price": 1250,
        "originalPrice": null,
        "stock": 23,
        "description": "Ceramic tea cups with saucers.",
        "published": true
      },
      {
        "id": "home-kitchen-026",
        "name": "Hand Mixer",
        "price": 1990,
        "originalPrice": 2390,
        "stock": 19,
        "description": "Lightweight hand mixer with multiple speeds.",
        "published": true
      },
      {
        "id": "home-kitchen-027",
        "name": "Dining Table Cloth",
        "price": 650,
        "originalPrice": null,
        "stock": 35,
        "description": "Easy-clean table cloth for dining tables.",
        "published": true
      },
      {
        "id": "home-kitchen-028",
        "name": "Anti-Slip Door Mat",
        "price": 490,
        "originalPrice": null,
        "stock": 70,
        "description": "Absorbent door mat with non-slip backing.",
        "published": true
      },
      {
        "id": "home-kitchen-029",
        "name": "Shoe Rack (4-tier)",
        "price": 1850,
        "originalPrice": 2190,
        "stock": 15,
        "description": "Compact rack for family footwear.",
        "published": true
      },
      {
        "id": "home-kitchen-030",
        "name": "Bathroom Bucket and Mug Set",
        "price": 590,
        "originalPrice": null,
        "stock": 0,
        "description": "Sturdy plastic bucket with matching mug.",
        "published": true
      },
      // SAMPLE DATA: Added records below are illustrative, not verified business facts.
      // Owner must verify names, prices, stock and descriptions before real sales.
      // Images use existing <product-id>.jpg paths and fallback; no image files were created.
      {
        "id": "home-kitchen-031",
        "name": "Silicone Spatula Set",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Silicone Spatula Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-032",
        "name": "Vegetable Peeler",
        "price": 150,
        "originalPrice": null,
        "stock": 30,
        "description": "Vegetable Peeler for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-033",
        "name": "Measuring Cup Set",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "Measuring Cup Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-034",
        "name": "Measuring Spoon Set",
        "price": 190,
        "originalPrice": null,
        "stock": 40,
        "description": "Measuring Spoon Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-035",
        "name": "Manual Vegetable Chopper",
        "price": 650,
        "originalPrice": null,
        "stock": 20,
        "description": "Manual Vegetable Chopper for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-036",
        "name": "Salad Spinner",
        "price": 890,
        "originalPrice": null,
        "stock": 25,
        "description": "Salad Spinner for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-037",
        "name": "Rolling Pin",
        "price": 350,
        "originalPrice": null,
        "stock": 30,
        "description": "Rolling Pin for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-038",
        "name": "Silicone Baking Mat",
        "price": 550,
        "originalPrice": null,
        "stock": 35,
        "description": "Silicone Baking Mat for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-039",
        "name": "Oven Mitt Pair",
        "price": 390,
        "originalPrice": null,
        "stock": 40,
        "description": "Oven Mitt Pair for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-040",
        "name": "Kitchen Apron",
        "price": 450,
        "originalPrice": null,
        "stock": 20,
        "description": "Kitchen Apron for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-041",
        "name": "Stainless Steel Colander",
        "price": 650,
        "originalPrice": null,
        "stock": 25,
        "description": "Stainless Steel Colander for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-042",
        "name": "Mixing Bowl Set",
        "price": 990,
        "originalPrice": null,
        "stock": 30,
        "description": "Mixing Bowl Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-043",
        "name": "Soup Ladle",
        "price": 250,
        "originalPrice": null,
        "stock": 35,
        "description": "Soup Ladle for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-044",
        "name": "Kitchen Tongs",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Kitchen Tongs for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-045",
        "name": "Potato Masher",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Potato Masher for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-046",
        "name": "Garlic Press",
        "price": 390,
        "originalPrice": null,
        "stock": 25,
        "description": "Garlic Press for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-047",
        "name": "Citrus Juicer",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Citrus Juicer for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-048",
        "name": "Ice Cube Tray Set",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "Ice Cube Tray Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-049",
        "name": "Reusable Food Cover Set",
        "price": 350,
        "originalPrice": null,
        "stock": 40,
        "description": "Reusable Food Cover Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-050",
        "name": "Oil Dispenser Bottle",
        "price": 490,
        "originalPrice": null,
        "stock": 20,
        "description": "Oil Dispenser Bottle for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-051",
        "name": "Butter Dish",
        "price": 390,
        "originalPrice": null,
        "stock": 25,
        "description": "Butter Dish for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-052",
        "name": "Bread Storage Box",
        "price": 990,
        "originalPrice": null,
        "stock": 30,
        "description": "Bread Storage Box for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-053",
        "name": "Fruit Basket",
        "price": 550,
        "originalPrice": null,
        "stock": 35,
        "description": "Fruit Basket for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-054",
        "name": "Kitchen Drawer Divider",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Kitchen Drawer Divider for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-055",
        "name": "Sink Caddy",
        "price": 390,
        "originalPrice": null,
        "stock": 20,
        "description": "Sink Caddy for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-056",
        "name": "Soap Dispenser",
        "price": 350,
        "originalPrice": null,
        "stock": 25,
        "description": "Soap Dispenser for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-057",
        "name": "Toilet Brush with Holder",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Toilet Brush with Holder for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-058",
        "name": "Shower Curtain",
        "price": 690,
        "originalPrice": null,
        "stock": 35,
        "description": "Shower Curtain for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-059",
        "name": "Bathroom Shelf",
        "price": 790,
        "originalPrice": null,
        "stock": 40,
        "description": "Bathroom Shelf for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-060",
        "name": "Laundry Mesh Bag Set",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Laundry Mesh Bag Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-061",
        "name": "Lint Roller",
        "price": 250,
        "originalPrice": null,
        "stock": 25,
        "description": "Lint Roller for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-062",
        "name": "Clothes Peg Set",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "Clothes Peg Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-063",
        "name": "Ironing Board Cover",
        "price": 690,
        "originalPrice": null,
        "stock": 35,
        "description": "Ironing Board Cover for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-064",
        "name": "Cushion Cover Set",
        "price": 590,
        "originalPrice": null,
        "stock": 40,
        "description": "Cushion Cover Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-065",
        "name": "Curtain Tieback Pair",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Curtain Tieback Pair for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-066",
        "name": "Underbed Storage Bag",
        "price": 790,
        "originalPrice": null,
        "stock": 25,
        "description": "Underbed Storage Bag for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-067",
        "name": "Reusable Shopping Bag Set",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Reusable Shopping Bag Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-068",
        "name": "Watering Can",
        "price": 550,
        "originalPrice": null,
        "stock": 35,
        "description": "Watering Can for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-069",
        "name": "Plant Pot Set",
        "price": 690,
        "originalPrice": null,
        "stock": 40,
        "description": "Plant Pot Set for everyday home and kitchen use.",
        "published": true
      },
      {
        "id": "home-kitchen-070",
        "name": "Handheld Dustpan and Brush",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Handheld Dustpan and Brush for everyday home and kitchen use.",
        "published": true
      }
    ],
    // Beauty & Personal Care — existing product IDs and data
    'beauty': [
      {
        "id": "beauty-001",
        "name": "Aloe Vera Soothing Gel (250 ml)",
        "price": 450,
        "originalPrice": 590,
        "stock": 70,
        "description": "Light gel for everyday skin hydration.",
        "published": true,
        "isFlashDeal": true,
        "isNewArrival": true
      },
      {
        "id": "beauty-002",
        "name": "Vitamin C Face Serum (30 ml)",
        "price": 1190,
        "originalPrice": 1490,
        "stock": 33,
        "description": "Lightweight face serum for a daily skincare routine.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "beauty-003",
        "name": "Sunscreen Lotion SPF 50 (50 g)",
        "price": 790,
        "originalPrice": 950,
        "stock": 45,
        "description": "Daily sunscreen lotion with SPF 50.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "beauty-004",
        "name": "Gentle Face Wash (150 ml)",
        "price": 390,
        "originalPrice": null,
        "stock": 90,
        "description": "Mild daily cleanser for the face.",
        "published": true
      },
      {
        "id": "beauty-005",
        "name": "Moisturizing Cream (100 ml)",
        "price": 650,
        "originalPrice": null,
        "stock": 60,
        "description": "Everyday cream for dry-feeling skin.",
        "published": true
      },
      {
        "id": "beauty-006",
        "name": "Coconut Hair Oil (200 ml)",
        "price": 280,
        "originalPrice": null,
        "stock": 100,
        "description": "Traditional coconut oil for hair and scalp care.",
        "published": true
      },
      {
        "id": "beauty-007",
        "name": "Argan Hair Oil (100 ml)",
        "price": 890,
        "originalPrice": 1090,
        "stock": 40,
        "description": "Hair oil for smooth, manageable-looking hair.",
        "published": true
      },
      {
        "id": "beauty-008",
        "name": "Daily Care Shampoo (350 ml)",
        "price": 550,
        "originalPrice": null,
        "stock": 52,
        "description": "Daily-use shampoo for scalp and hair care.",
        "published": true
      },
      {
        "id": "beauty-009",
        "name": "Smoothing Conditioner (300 ml)",
        "price": 520,
        "originalPrice": null,
        "stock": 48,
        "description": "Conditioner to help detangle after shampooing.",
        "published": true
      },
      {
        "id": "beauty-010",
        "name": "Hair Dryer (1800 W)",
        "price": 1990,
        "originalPrice": 2390,
        "stock": 22,
        "description": "Hair dryer with multiple heat and speed settings.",
        "published": true
      },
      {
        "id": "beauty-011",
        "name": "Ceramic Hair Straightener",
        "price": 2250,
        "originalPrice": 2690,
        "stock": 18,
        "description": "Straightener with adjustable temperature.",
        "published": true
      },
      {
        "id": "beauty-012",
        "name": "Rechargeable Beard Trimmer",
        "price": 1450,
        "originalPrice": null,
        "stock": 31,
        "description": "Cordless trimmer with adjustable comb guards.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "beauty-013",
        "name": "Electric Shaver",
        "price": 1790,
        "originalPrice": 2090,
        "stock": 24,
        "description": "Washable electric shaver for quick grooming.",
        "published": true
      },
      {
        "id": "beauty-014",
        "name": "Moisturizing Lip Balm",
        "price": 150,
        "originalPrice": null,
        "stock": 160,
        "description": "Soft lip balm for everyday use.",
        "published": true
      },
      {
        "id": "beauty-015",
        "name": "Body Lotion (400 ml)",
        "price": 590,
        "originalPrice": 690,
        "stock": 65,
        "description": "Daily body lotion for soft-feeling skin.",
        "published": true
      },
      {
        "id": "beauty-016",
        "name": "Hand Wash Refill (500 ml)",
        "price": 290,
        "originalPrice": null,
        "stock": 85,
        "description": "Gentle liquid hand wash refill pack.",
        "published": true
      },
      {
        "id": "beauty-017",
        "name": "Cotton Pads (100 pcs)",
        "price": 190,
        "originalPrice": null,
        "stock": 120,
        "description": "Soft cotton pads for toner and makeup removal.",
        "published": true
      },
      {
        "id": "beauty-018",
        "name": "Makeup Brush Set (12 pcs)",
        "price": 990,
        "originalPrice": 1290,
        "stock": 30,
        "description": "Brush set for face and eye makeup.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "beauty-019",
        "name": "Compact Face Powder",
        "price": 450,
        "originalPrice": null,
        "stock": 54,
        "description": "Pressed powder for a matte finish.",
        "published": true
      },
      {
        "id": "beauty-020",
        "name": "Black Kajal Pencil",
        "price": 180,
        "originalPrice": null,
        "stock": 140,
        "description": "Soft black kajal pencil for the eyes.",
        "published": true
      },
      {
        "id": "beauty-021",
        "name": "Sheet Face Masks (10 pcs)",
        "price": 590,
        "originalPrice": 750,
        "stock": 50,
        "description": "Hydrating sheet masks in a value pack.",
        "published": true
      },
      {
        "id": "beauty-022",
        "name": "Roll-On Deodorant (50 ml)",
        "price": 250,
        "originalPrice": null,
        "stock": 95,
        "description": "Everyday roll-on deodorant.",
        "published": true
      },
      {
        "id": "beauty-023",
        "name": "Electric Toothbrush",
        "price": 1650,
        "originalPrice": null,
        "stock": 20,
        "description": "Rechargeable toothbrush with soft bristles.",
        "published": true
      },
      {
        "id": "beauty-024",
        "name": "Wide-Tooth Comb Set (3 pcs)",
        "price": 250,
        "originalPrice": null,
        "stock": 80,
        "description": "Comb set for detangling and styling.",
        "published": true
      },
      {
        "id": "beauty-025",
        "name": "Hair Clip Set (20 pcs)",
        "price": 220,
        "originalPrice": null,
        "stock": 110,
        "description": "Assorted hair clips for daily styling.",
        "published": true
      },
      {
        "id": "beauty-026",
        "name": "Facial Massage Roller",
        "price": 590,
        "originalPrice": null,
        "stock": 36,
        "description": "Hand-held roller for a relaxing facial massage.",
        "published": true
      },
      {
        "id": "beauty-027",
        "name": "Facial Steamer",
        "price": 2490,
        "originalPrice": 2890,
        "stock": 13,
        "description": "Compact steamer for at-home facial routines.",
        "published": true
      },
      {
        "id": "beauty-028",
        "name": "Foot Care Cream (100 g)",
        "price": 350,
        "originalPrice": null,
        "stock": 58,
        "description": "Rich cream for dry heels.",
        "published": true
      },
      {
        "id": "beauty-029",
        "name": "Nail Clipper Set (7 pcs)",
        "price": 450,
        "originalPrice": null,
        "stock": 66,
        "description": "Stainless steel manicure set with case.",
        "published": true
      },
      {
        "id": "beauty-030",
        "name": "Perfumed Body Mist (150 ml)",
        "price": 690,
        "originalPrice": 850,
        "stock": 0,
        "description": "Light fragrance mist for daily wear.",
        "published": true
      },
      // SAMPLE DATA: Added records below are illustrative, not verified business facts.
      // Owner must verify names, prices, stock and descriptions before real sales.
      // Images use existing <product-id>.jpg paths and fallback; no image files were created.
      {
        "id": "beauty-031",
        "name": "Makeup Sponge Set",
        "price": 290,
        "originalPrice": null,
        "stock": 25,
        "description": "Makeup Sponge Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-032",
        "name": "Travel Cosmetic Pouch",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Travel Cosmetic Pouch for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-033",
        "name": "Vanity Mirror",
        "price": 690,
        "originalPrice": null,
        "stock": 35,
        "description": "Vanity Mirror for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-034",
        "name": "Compact Pocket Mirror",
        "price": 190,
        "originalPrice": null,
        "stock": 40,
        "description": "Compact Pocket Mirror for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-035",
        "name": "Reusable Makeup Remover Pads",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Reusable Makeup Remover Pads for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-036",
        "name": "Facial Cleansing Brush",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Facial Cleansing Brush for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-037",
        "name": "Silicone Face Mask Applicator",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "Silicone Face Mask Applicator for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-038",
        "name": "Hair Detangling Brush",
        "price": 390,
        "originalPrice": null,
        "stock": 35,
        "description": "Hair Detangling Brush for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-039",
        "name": "Round Styling Brush",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Round Styling Brush for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-040",
        "name": "Scalp Massage Brush",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Scalp Massage Brush for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-041",
        "name": "Satin Hair Scrunchie Set",
        "price": 250,
        "originalPrice": null,
        "stock": 25,
        "description": "Satin Hair Scrunchie Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-042",
        "name": "Spa Headband",
        "price": 220,
        "originalPrice": null,
        "stock": 30,
        "description": "Spa Headband for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-043",
        "name": "Shower Cap Set",
        "price": 190,
        "originalPrice": null,
        "stock": 35,
        "description": "Shower Cap Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-044",
        "name": "Hair Roller Set",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Hair Roller Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-045",
        "name": "Heatless Curling Ribbon",
        "price": 390,
        "originalPrice": null,
        "stock": 20,
        "description": "Heatless Curling Ribbon for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-046",
        "name": "Hair Sectioning Clip Set",
        "price": 250,
        "originalPrice": null,
        "stock": 25,
        "description": "Hair Sectioning Clip Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-047",
        "name": "Spray Bottle",
        "price": 150,
        "originalPrice": null,
        "stock": 30,
        "description": "Spray Bottle for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-048",
        "name": "Travel Toiletry Bottle Set",
        "price": 350,
        "originalPrice": null,
        "stock": 35,
        "description": "Travel Toiletry Bottle Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-049",
        "name": "Soap Travel Case",
        "price": 190,
        "originalPrice": null,
        "stock": 40,
        "description": "Soap Travel Case for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-050",
        "name": "Exfoliating Bath Glove",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Exfoliating Bath Glove for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-051",
        "name": "Body Scrub Brush",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Body Scrub Brush for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-052",
        "name": "Bath Sponge Set",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "Bath Sponge Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-053",
        "name": "Back Scrubber Strap",
        "price": 350,
        "originalPrice": null,
        "stock": 35,
        "description": "Back Scrubber Strap for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-054",
        "name": "Pumice Foot Stone",
        "price": 190,
        "originalPrice": null,
        "stock": 40,
        "description": "Pumice Foot Stone for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-055",
        "name": "Foot File",
        "price": 290,
        "originalPrice": null,
        "stock": 20,
        "description": "Foot File for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-056",
        "name": "Pedicure Toe Separator Set",
        "price": 150,
        "originalPrice": null,
        "stock": 25,
        "description": "Pedicure Toe Separator Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-057",
        "name": "Nail Buffer Block Set",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "Nail Buffer Block Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-058",
        "name": "Glass Nail File",
        "price": 250,
        "originalPrice": null,
        "stock": 35,
        "description": "Glass Nail File for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-059",
        "name": "Cuticle Pusher",
        "price": 190,
        "originalPrice": null,
        "stock": 40,
        "description": "Cuticle Pusher for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-060",
        "name": "Nail Art Brush Set",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Nail Art Brush Set for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-061",
        "name": "Makeup Brush Cleaning Mat",
        "price": 250,
        "originalPrice": null,
        "stock": 25,
        "description": "Makeup Brush Cleaning Mat for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-062",
        "name": "Makeup Brush Holder",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Makeup Brush Holder for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-063",
        "name": "Lipstick Organizer",
        "price": 390,
        "originalPrice": null,
        "stock": 35,
        "description": "Lipstick Organizer for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-064",
        "name": "Cotton Pad Dispenser",
        "price": 350,
        "originalPrice": null,
        "stock": 40,
        "description": "Cotton Pad Dispenser for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-065",
        "name": "Eyebrow Grooming Kit",
        "price": 290,
        "originalPrice": null,
        "stock": 20,
        "description": "Eyebrow Grooming Kit for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-066",
        "name": "Eyelash Curler",
        "price": 350,
        "originalPrice": null,
        "stock": 25,
        "description": "Eyelash Curler for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-067",
        "name": "Precision Tweezers",
        "price": 250,
        "originalPrice": null,
        "stock": 30,
        "description": "Precision Tweezers for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-068",
        "name": "Perfume Travel Atomizer",
        "price": 350,
        "originalPrice": null,
        "stock": 35,
        "description": "Perfume Travel Atomizer for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-069",
        "name": "Grooming Scissors",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Grooming Scissors for everyday personal care and organization.",
        "published": true
      },
      {
        "id": "beauty-070",
        "name": "Toiletry Organizer Basket",
        "price": 550,
        "originalPrice": null,
        "stock": 20,
        "description": "Toiletry Organizer Basket for everyday personal care and organization.",
        "published": true
      }
    ],
    // Games & Toys — existing product records. Legacy IDs are retained for compatibility.
    'fashion': [
      {
        "id": "fashion-001",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Building Blocks Set (120 Pieces)",
        "price": 990,
        "originalPrice": 1290,
        "stock": 60,
        "description": "A colorful building-block set that encourages creativity, coordination and imaginative play.",
        "published": true,
        "isFlashDeal": true,
        "isFeatured": true,
        "specs": {
          "Pieces": "120 pieces",
          "Recommended age": "3+ years"
        }
      },
      {
        "id": "fashion-002",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Remote Control Racing Car",
        "price": 1490,
        "originalPrice": 1890,
        "stock": 30,
        "description": "A fun remote-control car for indoor racing and imaginative adventures.",
        "published": true,
        "isFeatured": true,
        "specs": {
          "Control": "Remote control",
          "Recommended age": "6+ years"
        }
      },
      {
        "id": "fashion-003",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Alphabet & Number Puzzle Board",
        "price": 350,
        "originalPrice": 450,
        "stock": 75,
        "description": "A colorful learning puzzle that helps children practice letters, numbers and matching.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "fashion-004",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Wooden Shape Sorter",
        "price": 690,
        "originalPrice": 890,
        "stock": 40,
        "description": "A shape-sorting toy designed to introduce colors, shapes and problem-solving.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "fashion-005",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Magnetic Building Tiles (32 Pieces)",
        "price": 1690,
        "originalPrice": 1990,
        "stock": 25,
        "description": "Magnetic construction tiles for making towers, houses and imaginative 3D designs.",
        "published": true,
        "isFlashDeal": true,
        "isFeatured": true
      },
      {
        "id": "fashion-006",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Family Board Game Set",
        "price": 390,
        "originalPrice": 490,
        "stock": 50,
        "description": "A family game bundle for fun game nights and friendly competition.",
        "published": true,
        "isBestSeller": true
      },
      {
        "id": "fashion-007",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Chess Board Game Set",
        "price": 550,
        "originalPrice": 690,
        "stock": 35,
        "description": "A classic chess set for developing strategy, focus and logical thinking.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "fashion-008",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Jigsaw Puzzle (100 Pieces)",
        "price": 450,
        "originalPrice": 590,
        "stock": 45,
        "description": "A 100-piece jigsaw puzzle for relaxed, screen-free play at home.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "fashion-009",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Toy Doctor Play Set",
        "price": 790,
        "originalPrice": 990,
        "stock": 36,
        "description": "A pretend-play doctor kit that lets children explore imaginative role play.",
        "published": true
      },
      {
        "id": "fashion-010",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Kids Kitchen Play Set",
        "price": 1290,
        "originalPrice": 1590,
        "stock": 22,
        "description": "A pretend kitchen set for creative make-believe cooking and serving games.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "fashion-011",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Bubble Blaster Toy",
        "price": 450,
        "originalPrice": 590,
        "stock": 55,
        "description": "A bubble-blasting toy for supervised outdoor play and parties.",
        "published": true,
        "isFlashDeal": true
      },
      {
        "id": "fashion-012",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Pull-Back Toy Cars (6-Piece Set)",
        "price": 390,
        "originalPrice": 490,
        "stock": 65,
        "description": "Six pull-back cars for racing, collecting and pretend road adventures.",
        "published": true
      },
      {
        "id": "fashion-013",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Die-Cast Model Car",
        "price": 250,
        "originalPrice": 320,
        "stock": 90,
        "description": "A small die-cast model car for play or collecting.",
        "published": true,
        "isBestSeller": true
      },
      {
        "id": "fashion-014",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Remote Control Stunt Car",
        "price": 1790,
        "originalPrice": 2190,
        "stock": 18,
        "description": "A stunt-style remote-control car for twists, turns and action-packed play.",
        "published": true,
        "isNewArrival": true,
        "isFeatured": true
      },
      {
        "id": "fashion-015",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Plush Teddy Bear (30 cm)",
        "price": 650,
        "originalPrice": 850,
        "stock": 30,
        "description": "A soft plush teddy bear suitable for cuddles, gifts and imaginative play.",
        "published": true
      },
      {
        "id": "fashion-016",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Baby Rattle & Teether Set",
        "price": 390,
        "originalPrice": 490,
        "stock": 45,
        "description": "A baby rattle and teether set designed for supervised sensory play.",
        "published": true
      },
      {
        "id": "fashion-017",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Rainbow Stacking Rings",
        "price": 350,
        "originalPrice": 450,
        "stock": 50,
        "description": "Bright stacking rings that support color recognition and hand-eye coordination.",
        "published": true
      },
      {
        "id": "fashion-018",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Musical Learning Toy",
        "price": 890,
        "originalPrice": 1090,
        "stock": 26,
        "description": "An interactive musical toy for early sound exploration and play.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "fashion-019",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Drawing & Coloring Kit (48 Pieces)",
        "price": 590,
        "originalPrice": 750,
        "stock": 40,
        "description": "A creative art kit with drawing and coloring supplies for young artists.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "fashion-020",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Watercolor Paint Set (24 Colors)",
        "price": 290,
        "originalPrice": 390,
        "stock": 75,
        "description": "A 24-color watercolor set for art projects and supervised creative activities.",
        "published": true
      },
      {
        "id": "fashion-021",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "DIY Arts & Crafts Kit",
        "price": 690,
        "originalPrice": 890,
        "stock": 32,
        "description": "A hands-on craft kit for making simple art projects and decorations.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "fashion-022",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Kids Magnetic Dart Board",
        "price": 750,
        "originalPrice": 950,
        "stock": 24,
        "description": "A magnetic dart-board game for supervised target practice and friendly challenges.",
        "published": true
      },
      {
        "id": "fashion-023",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Flying Disc (Frisbee)",
        "price": 250,
        "originalPrice": 350,
        "stock": 60,
        "description": "A lightweight flying disc for outdoor fun at parks and open spaces.",
        "published": true
      },
      {
        "id": "fashion-024",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Kids Badminton Set",
        "price": 690,
        "originalPrice": 890,
        "stock": 28,
        "description": "A starter badminton set for family recreation and outdoor activity.",
        "published": true
      },
      {
        "id": "fashion-025",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Mini Basketball Hoop Set",
        "price": 1190,
        "originalPrice": 1490,
        "stock": 20,
        "description": "A mini hoop set for practicing shots and enjoying indoor play.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "fashion-026",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Mini Football (Size 3)",
        "price": 490,
        "originalPrice": 650,
        "stock": 42,
        "description": "A size 3 mini football for casual practice and recreational play.",
        "published": true,
        "isFlashDeal": true
      },
      {
        "id": "fashion-027",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Dominoes Game Set",
        "price": 350,
        "originalPrice": 450,
        "stock": 50,
        "description": "A classic dominoes set for number matching and family game sessions.",
        "published": true
      },
      {
        "id": "fashion-028",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Playing Cards Deck",
        "price": 120,
        "originalPrice": 150,
        "stock": 120,
        "description": "A standard deck of playing cards for a variety of family card games.",
        "published": true,
        "isBestSeller": true
      },
      {
        "id": "fashion-029",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "3×3 Speed Cube Puzzle",
        "price": 290,
        "originalPrice": 390,
        "stock": 80,
        "description": "A classic 3×3 twisty cube puzzle for practice, focus and problem-solving.",
        "published": true
      },
      {
        "id": "fashion-030",
        "image": "assets/images/products/placeholder-product.jpg",
        "name": "Doll House Play Set",
        "price": 1890,
        "originalPrice": 2290,
        "stock": 15,
        "description": "A dollhouse play set for storytelling and imaginative role play.",
        "published": true,
        "isNewArrival": true,
        "isFeatured": true
      },
      // SAMPLE DATA: Added records below are illustrative, not verified business facts.
      // Owner must verify names, prices, stock and descriptions before real sales.
      // Images use existing <product-id>.jpg paths and fallback; no image files were created.
      {
        "id": "fashion-031",
        "name": "Checkers Board Set",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Checkers Board Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-032",
        "name": "Snakes and Ladders Board Game",
        "price": 350,
        "originalPrice": null,
        "stock": 30,
        "description": "Snakes and Ladders Board Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-033",
        "name": "Ludo Board Game",
        "price": 390,
        "originalPrice": null,
        "stock": 35,
        "description": "Ludo Board Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-034",
        "name": "Travel Backgammon Set",
        "price": 750,
        "originalPrice": null,
        "stock": 40,
        "description": "Travel Backgammon Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-035",
        "name": "Tangram Puzzle",
        "price": 290,
        "originalPrice": null,
        "stock": 20,
        "description": "Tangram Puzzle for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-036",
        "name": "Wooden Balance Game",
        "price": 690,
        "originalPrice": null,
        "stock": 25,
        "description": "Wooden Balance Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-037",
        "name": "Memory Matching Cards",
        "price": 250,
        "originalPrice": null,
        "stock": 30,
        "description": "Memory Matching Cards for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-038",
        "name": "Picture Bingo Game",
        "price": 450,
        "originalPrice": null,
        "stock": 35,
        "description": "Picture Bingo Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-039",
        "name": "Storytelling Card Set",
        "price": 350,
        "originalPrice": null,
        "stock": 40,
        "description": "Storytelling Card Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-040",
        "name": "Puzzle Cube (2×2)",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Puzzle Cube (2×2) for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-041",
        "name": "Puzzle Cube (4×4)",
        "price": 590,
        "originalPrice": null,
        "stock": 25,
        "description": "Puzzle Cube (4×4) for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-042",
        "name": "Sliding Number Puzzle",
        "price": 190,
        "originalPrice": null,
        "stock": 30,
        "description": "Sliding Number Puzzle for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-043",
        "name": "Maze Puzzle Ball",
        "price": 550,
        "originalPrice": null,
        "stock": 35,
        "description": "Maze Puzzle Ball for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-044",
        "name": "Wooden Marble Run",
        "price": 1490,
        "originalPrice": null,
        "stock": 40,
        "description": "Wooden Marble Run for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-045",
        "name": "Toy Bowling Set",
        "price": 690,
        "originalPrice": null,
        "stock": 20,
        "description": "Toy Bowling Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-046",
        "name": "Ring Toss Game",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Ring Toss Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-047",
        "name": "Bean Bag Toss Set",
        "price": 790,
        "originalPrice": null,
        "stock": 30,
        "description": "Bean Bag Toss Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-048",
        "name": "Foam Glider Set",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "Foam Glider Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-049",
        "name": "Toy Train Set",
        "price": 1290,
        "originalPrice": null,
        "stock": 40,
        "description": "Toy Train Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-050",
        "name": "Toy Farm Animal Figures",
        "price": 450,
        "originalPrice": null,
        "stock": 20,
        "description": "Toy Farm Animal Figures for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-051",
        "name": "Toy Dinosaur Figure Set",
        "price": 590,
        "originalPrice": null,
        "stock": 25,
        "description": "Toy Dinosaur Figure Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-052",
        "name": "Toy Ocean Animal Set",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Toy Ocean Animal Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-053",
        "name": "Toy Tool Bench Set",
        "price": 1490,
        "originalPrice": null,
        "stock": 35,
        "description": "Toy Tool Bench Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-054",
        "name": "Pretend Grocery Play Set",
        "price": 790,
        "originalPrice": null,
        "stock": 40,
        "description": "Pretend Grocery Play Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-055",
        "name": "Pretend Cash Register",
        "price": 990,
        "originalPrice": null,
        "stock": 20,
        "description": "Pretend Cash Register for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-056",
        "name": "Puppet Theatre Set",
        "price": 1190,
        "originalPrice": null,
        "stock": 25,
        "description": "Puppet Theatre Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-057",
        "name": "Hand Puppet Set",
        "price": 690,
        "originalPrice": null,
        "stock": 30,
        "description": "Hand Puppet Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-058",
        "name": "Finger Puppet Set",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "Finger Puppet Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-059",
        "name": "Toy Telescope",
        "price": 750,
        "originalPrice": null,
        "stock": 40,
        "description": "Toy Telescope for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-060",
        "name": "Toy Binoculars",
        "price": 450,
        "originalPrice": null,
        "stock": 20,
        "description": "Toy Binoculars for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-061",
        "name": "Kids Drum Play Set",
        "price": 990,
        "originalPrice": null,
        "stock": 25,
        "description": "Kids Drum Play Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-062",
        "name": "Toy Xylophone",
        "price": 650,
        "originalPrice": null,
        "stock": 30,
        "description": "Toy Xylophone for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-063",
        "name": "Toy Tambourine",
        "price": 290,
        "originalPrice": null,
        "stock": 35,
        "description": "Toy Tambourine for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-064",
        "name": "Clay Modeling Tool Set",
        "price": 350,
        "originalPrice": null,
        "stock": 40,
        "description": "Clay Modeling Tool Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-065",
        "name": "Origami Paper Kit",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Origami Paper Kit for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-066",
        "name": "Bead Craft Kit",
        "price": 590,
        "originalPrice": null,
        "stock": 25,
        "description": "Bead Craft Kit for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-067",
        "name": "Sand Play Bucket Set",
        "price": 450,
        "originalPrice": null,
        "stock": 30,
        "description": "Sand Play Bucket Set for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-068",
        "name": "Toy Fishing Game",
        "price": 650,
        "originalPrice": null,
        "stock": 35,
        "description": "Toy Fishing Game for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-069",
        "name": "Puzzle Storage Mat",
        "price": 790,
        "originalPrice": null,
        "stock": 40,
        "description": "Puzzle Storage Mat for everyday play and recreation.",
        "published": true
      },
      {
        "id": "fashion-070",
        "name": "Card Game Holder Set",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Card Game Holder Set for everyday play and recreation.",
        "published": true
      }
    ],
    // Baby & Kids — existing product IDs and data
    'baby-kids': [
      {
        "id": "baby-kids-001",
        "name": "Baby Diaper Pants (Pack of 44)",
        "price": 1450,
        "originalPrice": 1690,
        "stock": 45,
        "description": "Soft diaper pants for everyday use.",
        "published": true,
        "isFlashDeal": true,
        "isFeatured": true,
        "variants": [
          {
            "name": "Size",
            "options": [
              "M",
              "L",
              "XL"
            ]
          }
        ]
      },
      {
        "id": "baby-kids-002",
        "name": "Baby Wipes (80 pcs)",
        "price": 290,
        "originalPrice": null,
        "stock": 100,
        "description": "Soft wipes for gentle everyday cleaning.",
        "published": true
      },
      {
        "id": "baby-kids-003",
        "name": "Baby Lotion (200 ml)",
        "price": 450,
        "originalPrice": 550,
        "stock": 60,
        "description": "Daily lotion made for baby skin.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "baby-kids-004",
        "name": "Baby Shampoo (200 ml)",
        "price": 390,
        "originalPrice": null,
        "stock": 55,
        "description": "Mild shampoo for babies and toddlers.",
        "published": true
      },
      {
        "id": "baby-kids-005",
        "name": "Feeding Bottle (250 ml)",
        "price": 490,
        "originalPrice": null,
        "stock": 70,
        "description": "Feeding bottle with a soft silicone nipple.",
        "published": true
      },
      {
        "id": "baby-kids-006",
        "name": "Silicone Pacifier (2 pcs)",
        "price": 290,
        "originalPrice": null,
        "stock": 80,
        "description": "Silicone pacifiers with protective cover.",
        "published": true
      },
      {
        "id": "baby-kids-007",
        "name": "Soft Baby Blanket",
        "price": 890,
        "originalPrice": 1090,
        "stock": 40,
        "description": "Warm and soft blanket for babies.",
        "published": true
      },
      {
        "id": "baby-kids-008",
        "name": "Cotton Baby Romper",
        "price": 650,
        "originalPrice": null,
        "stock": 50,
        "description": "Comfortable cotton romper.",
        "published": true,
        "variants": [
          {
            "name": "Age",
            "options": [
              "0-3 months",
              "3-6 months",
              "6-12 months"
            ]
          }
        ]
      },
      {
        "id": "baby-kids-009",
        "name": "Kids Cotton T-Shirt",
        "price": 390,
        "originalPrice": 490,
        "stock": 90,
        "description": "Soft cotton T-shirt for kids.",
        "published": true,
        "variants": [
          {
            "name": "Age",
            "options": [
              "2-3 years",
              "4-5 years",
              "6-7 years"
            ]
          }
        ]
      },
      {
        "id": "baby-kids-010",
        "name": "Kids Sneakers",
        "price": 1190,
        "originalPrice": 1450,
        "stock": 30,
        "description": "Lightweight sneakers for school and play.",
        "published": true,
        "variants": [
          {
            "name": "Size",
            "options": [
              "28",
              "30",
              "32",
              "34"
            ]
          }
        ]
      },
      {
        "id": "baby-kids-011",
        "name": "Kids School Bag",
        "price": 990,
        "originalPrice": 1250,
        "stock": 35,
        "description": "Padded school bag with multiple pockets.",
        "published": true,
        "isFeatured": true
      },
      {
        "id": "baby-kids-012",
        "name": "Kids Lunch Box",
        "price": 450,
        "originalPrice": null,
        "stock": 65,
        "description": "Two-compartment lunch box for school.",
        "published": true
      },
      {
        "id": "baby-kids-013",
        "name": "Kids Water Bottle (500 ml)",
        "price": 350,
        "originalPrice": null,
        "stock": 75,
        "description": "Easy-carry bottle with a strap.",
        "published": true
      },
      {
        "id": "baby-kids-014",
        "name": "Building Blocks Set (100 pcs)",
        "price": 950,
        "originalPrice": 1190,
        "stock": 26,
        "description": "Colourful blocks for creative play.",
        "published": true,
        "isNewArrival": true
      },
      {
        "id": "baby-kids-015",
        "name": "Soft Teddy Bear (40 cm)",
        "price": 790,
        "originalPrice": null,
        "stock": 32,
        "description": "Plush teddy bear.",
        "published": true
      },
      {
        "id": "baby-kids-016",
        "name": "Jigsaw Puzzle (60 pcs)",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Fun puzzle for young learners.",
        "published": true
      },
      {
        "id": "baby-kids-017",
        "name": "Colouring Book Set (4 books)",
        "price": 290,
        "originalPrice": null,
        "stock": 85,
        "description": "Colouring books with fun pictures.",
        "published": true
      },
      {
        "id": "baby-kids-018",
        "name": "Crayon Set (24 colours)",
        "price": 220,
        "originalPrice": null,
        "stock": 110,
        "description": "Bright wax crayons.",
        "published": true
      },
      {
        "id": "baby-kids-019",
        "name": "Toy Car Set (6 pcs)",
        "price": 590,
        "originalPrice": 750,
        "stock": 48,
        "description": "Pull-back toy cars in assorted colours.",
        "published": true
      },
      {
        "id": "baby-kids-020",
        "name": "Doll Styling & Dress-Up Play Set",
        "price": 890,
        "originalPrice": null,
        "stock": 28,
        "description": "Doll with outfits and accessories.",
        "published": true
      },
      {
        "id": "baby-kids-021",
        "name": "Baby Bath Tub",
        "price": 1450,
        "originalPrice": null,
        "stock": 18,
        "description": "Foldable bath tub for babies.",
        "published": true
      },
      {
        "id": "baby-kids-022",
        "name": "Hooded Baby Towel",
        "price": 590,
        "originalPrice": null,
        "stock": 42,
        "description": "Soft hooded towel.",
        "published": true
      },
      {
        "id": "baby-kids-023",
        "name": "Baby Cap and Socks Set",
        "price": 350,
        "originalPrice": null,
        "stock": 60,
        "description": "Cosy cap and socks set.",
        "published": true
      },
      {
        "id": "baby-kids-024",
        "name": "Kids Umbrella",
        "price": 450,
        "originalPrice": null,
        "stock": 38,
        "description": "Small umbrella with safe rounded tips.",
        "published": true
      },
      {
        "id": "baby-kids-025",
        "name": "Sippy Cup (240 ml)",
        "price": 390,
        "originalPrice": null,
        "stock": 56,
        "description": "Cup with handles and a drinking spout.",
        "published": true
      },
      {
        "id": "baby-kids-026",
        "name": "Baby Bib (3 pcs)",
        "price": 320,
        "originalPrice": null,
        "stock": 70,
        "description": "Soft cotton bibs.",
        "published": true
      },
      {
        "id": "baby-kids-027",
        "name": "Teether Toy",
        "price": 250,
        "originalPrice": null,
        "stock": 64,
        "description": "Soft teether toy for babies.",
        "published": true
      },
      {
        "id": "baby-kids-028",
        "name": "Kids Pencil Box",
        "price": 290,
        "originalPrice": null,
        "stock": 55,
        "description": "Pencil box with compartments.",
        "published": true
      },
      {
        "id": "baby-kids-029",
        "name": "Alphabet Learning Board",
        "price": 690,
        "originalPrice": 850,
        "stock": 30,
        "description": "Educational alphabet board for early learners.",
        "published": true
      },
      {
        "id": "baby-kids-030",
        "name": "Kids Raincoat",
        "price": 790,
        "originalPrice": null,
        "stock": 0,
        "description": "Hooded raincoat for rainy days.",
        "published": true
      },
      {
        "id": "baby-kids-031",
        "name": "Baby Hair Brush Set",
        "price": 320,
        "originalPrice": null,
        "stock": 45,
        "description": "Soft-bristle brush and comb set.",
        "published": true
      },
      // SAMPLE DATA: Added records below are illustrative, not verified business facts.
      // Owner must verify names, prices, stock and descriptions before real sales.
      // Images use existing <product-id>.jpg paths and fallback; no image files were created.
      {
        "id": "baby-kids-032",
        "name": "Baby Changing Mat",
        "price": 690,
        "originalPrice": null,
        "stock": 30,
        "description": "Baby Changing Mat for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-033",
        "name": "Diaper Storage Caddy",
        "price": 890,
        "originalPrice": null,
        "stock": 35,
        "description": "Diaper Storage Caddy for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-034",
        "name": "Baby Laundry Bag",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Baby Laundry Bag for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-035",
        "name": "Baby Washcloth Set",
        "price": 350,
        "originalPrice": null,
        "stock": 20,
        "description": "Baby Washcloth Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-036",
        "name": "Baby Burp Cloth Set",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Baby Burp Cloth Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-037",
        "name": "Cotton Swaddle Wrap",
        "price": 790,
        "originalPrice": null,
        "stock": 30,
        "description": "Cotton Swaddle Wrap for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-038",
        "name": "Baby Fitted Cot Sheet",
        "price": 650,
        "originalPrice": null,
        "stock": 35,
        "description": "Baby Fitted Cot Sheet for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-039",
        "name": "Baby Clothing Hanger Set",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Baby Clothing Hanger Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-040",
        "name": "Baby Wardrobe Divider Set",
        "price": 250,
        "originalPrice": null,
        "stock": 20,
        "description": "Baby Wardrobe Divider Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-041",
        "name": "Baby Nail Care Kit",
        "price": 390,
        "originalPrice": null,
        "stock": 25,
        "description": "Baby Nail Care Kit for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-042",
        "name": "Baby Bath Rinse Cup",
        "price": 350,
        "originalPrice": null,
        "stock": 30,
        "description": "Baby Bath Rinse Cup for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-043",
        "name": "Bath Toy Organizer",
        "price": 450,
        "originalPrice": null,
        "stock": 35,
        "description": "Bath Toy Organizer for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-044",
        "name": "Feeding Bottle Cleaning Brush",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Feeding Bottle Cleaning Brush for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-045",
        "name": "Feeding Bottle Drying Rack",
        "price": 590,
        "originalPrice": null,
        "stock": 20,
        "description": "Feeding Bottle Drying Rack for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-046",
        "name": "Baby Food Storage Containers",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Baby Food Storage Containers for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-047",
        "name": "Toddler Training Spoon Set",
        "price": 290,
        "originalPrice": null,
        "stock": 30,
        "description": "Toddler Training Spoon Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-048",
        "name": "Toddler Divided Plate",
        "price": 450,
        "originalPrice": null,
        "stock": 35,
        "description": "Toddler Divided Plate for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-049",
        "name": "Silicone Feeding Bowl",
        "price": 550,
        "originalPrice": null,
        "stock": 40,
        "description": "Silicone Feeding Bowl for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-050",
        "name": "Snack Cup with Lid",
        "price": 390,
        "originalPrice": null,
        "stock": 20,
        "description": "Snack Cup with Lid for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-051",
        "name": "Baby Stroller Organizer",
        "price": 790,
        "originalPrice": null,
        "stock": 25,
        "description": "Baby Stroller Organizer for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-052",
        "name": "Stroller Rain Cover",
        "price": 890,
        "originalPrice": null,
        "stock": 30,
        "description": "Stroller Rain Cover for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-053",
        "name": "Pram Storage Hook Set",
        "price": 250,
        "originalPrice": null,
        "stock": 35,
        "description": "Pram Storage Hook Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-054",
        "name": "Kids Travel Neck Pillow",
        "price": 590,
        "originalPrice": null,
        "stock": 40,
        "description": "Kids Travel Neck Pillow for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-055",
        "name": "Kids Sun Hat",
        "price": 390,
        "originalPrice": null,
        "stock": 20,
        "description": "Kids Sun Hat for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-056",
        "name": "Kids Cotton Shorts",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Kids Cotton Shorts for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-057",
        "name": "Kids Pajama Set",
        "price": 790,
        "originalPrice": null,
        "stock": 30,
        "description": "Kids Pajama Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-058",
        "name": "Kids Sock Set",
        "price": 350,
        "originalPrice": null,
        "stock": 35,
        "description": "Kids Sock Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-059",
        "name": "Kids Slippers",
        "price": 450,
        "originalPrice": null,
        "stock": 40,
        "description": "Kids Slippers for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-060",
        "name": "Kids Belt",
        "price": 290,
        "originalPrice": null,
        "stock": 20,
        "description": "Kids Belt for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-061",
        "name": "Kids Hairband Set",
        "price": 250,
        "originalPrice": null,
        "stock": 25,
        "description": "Kids Hairband Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-062",
        "name": "Kids Stationery Organizer",
        "price": 390,
        "originalPrice": null,
        "stock": 30,
        "description": "Kids Stationery Organizer for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-063",
        "name": "Kids Drawing Apron",
        "price": 350,
        "originalPrice": null,
        "stock": 35,
        "description": "Kids Drawing Apron for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-064",
        "name": "Kids Art Paper Pad",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Kids Art Paper Pad for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-065",
        "name": "Kids Storybook Set",
        "price": 690,
        "originalPrice": null,
        "stock": 20,
        "description": "Kids Storybook Set for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-066",
        "name": "Kids Bookends",
        "price": 450,
        "originalPrice": null,
        "stock": 25,
        "description": "Kids Bookends for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-067",
        "name": "Kids Backpack Rain Cover",
        "price": 350,
        "originalPrice": null,
        "stock": 30,
        "description": "Kids Backpack Rain Cover for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-068",
        "name": "Kids Lunch Bag",
        "price": 590,
        "originalPrice": null,
        "stock": 35,
        "description": "Kids Lunch Bag for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-069",
        "name": "Kids Shoe Storage Bag",
        "price": 290,
        "originalPrice": null,
        "stock": 40,
        "description": "Kids Shoe Storage Bag for everyday baby or child care and organization.",
        "published": true
      },
      {
        "id": "baby-kids-070",
        "name": "Kids Laundry Basket",
        "price": 650,
        "originalPrice": null,
        "stock": 20,
        "description": "Kids Laundry Basket for everyday baby or child care and organization.",
        "published": true
      }
    ]
  };

  // Maximum product slots per existing category. Keep new IDs within 001–070.
  const SLOTS_PER_CATEGORY = 70;

  /* ---- Catalogue processing and validation (normally no edits needed) ---- */

  const PRODUCTS = [];
  const PUBLIC_PRODUCTS = [];
  const PUBLIC_BY_ID = new Map();

  function padSlot(n) { return String(n).padStart(3, '0'); }

  function toPositiveInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function normalizeVariants(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(v => v && typeof v.name === 'string' && Array.isArray(v.options) && v.options.length)
      .map(v => ({ name: v.name.trim(), options: v.options.map(o => String(o).trim()).filter(Boolean) }))
      .filter(v => v.name && v.options.length);
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  /** Only local product-folder paths and common raster extensions are accepted. */
  function normalizeProductImagePath(value, fallback) {
    if (typeof value !== 'string' || !value.trim()) return fallback;
    let path = value.trim().replace(/^\.\//, '');
    if (!path.startsWith('assets/images/products/') || path.split('/').includes('..') ||
        !/^[A-Za-z0-9_./ -]+\.(?:jpe?g|png|webp)$/i.test(path)) {
      console.warn('[ShobPaben] Invalid local product image path; using fallback:', value);
      return fallback;
    }
    return path;
  }

  function defaultProductImagePath(id) {
    return 'assets/images/products/' + id + '.jpg';
  }

  function createEmptySlot(categoryId, slot) {
    const id = categoryId + '-' + padSlot(slot);
    return {
      id, slot, order: 0, category: categoryId, name: '', slug: id,
      image: PLACEHOLDER_IMAGE, images: [PLACEHOLDER_IMAGE],
      price: null, originalPrice: null, discountPercent: 0, offer: '', description: '', stock: 0, isPublished: false,
      brand: '', variants: [], specs: [], warranty: '', isFeatured: false, isNewArrival: false,
      isBestSeller: false, isFlashDeal: false, createdAt: '', searchIndex: null
    };
  }

  function createProduct(categoryId, slot, fields) {
    const f = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
    const expectedSlotId = categoryId + '-' + padSlot(slot);
    const id = typeof f.id === 'string' ? f.id.trim() : '';
    if (!new RegExp('^' + categoryId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d{3}$').test(id) || id !== expectedSlotId) {
      console.warn('[ShobPaben] Product ID must match its category slot (' + expectedSlotId + '); this record was ignored.');
      return null;
    }

    const name = String(f.name || '').trim();
    const price = toPositiveInt(f.price);
    const candidateOriginal = toPositiveInt(f.originalPrice);
    const originalPrice = candidateOriginal && price && candidateOriginal > price ? candidateOriginal : null;
    const discountPercent = originalPrice ? Math.round((1 - price / originalPrice) * 100) : 0;
    const defaultImage = defaultProductImagePath(id);
    const galleryInput = Array.isArray(f.images) ? f.images : [];
    const gallery = galleryInput.map(path => normalizeProductImagePath(path, '')).filter(Boolean);
    const mainImage = normalizeProductImagePath(f.image || gallery[0], defaultImage);
    const images = Array.from(new Set([mainImage, ...gallery]));
    const published = f.isPublished !== undefined ? f.isPublished === true : (f.published !== undefined ? f.published === true : true);
    const createdAt = f.createdAt && Number.isFinite(Date.parse(f.createdAt)) ? String(f.createdAt) : '';
    const specs = f.specs && typeof f.specs === 'object' && !Array.isArray(f.specs)
      ? Object.keys(f.specs).map(key => [key, String(f.specs[key])]) : [];
    const stockValue = Number(f.stock);
    const stock = Number.isFinite(stockValue) && stockValue >= 0 && Number.isInteger(stockValue) ? stockValue : 0;
    if (f.stock !== undefined && stock !== stockValue) console.warn('[ShobPaben] Invalid stock for ' + id + '; treating it as 0.');
    if (candidateOriginal && price && candidateOriginal <= price) console.warn('[ShobPaben] originalPrice must exceed price for ' + id + '; discount display disabled.');

    const product = {
      id, slot, order: 0, category: categoryId, name,
      slug: String(f.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || id),
      image: mainImage, images, price, originalPrice, discountPercent,
      offer: String(f.offer || '').trim(), description: String(f.description || '').trim(), stock, isPublished: published,
      brand: String(f.brand || '').trim(), variants: normalizeVariants(f.variants), specs,
      warranty: String(f.warranty || '').trim(),
      isFeatured: f.isFeatured === true, isNewArrival: f.isNewArrival === true,
      isBestSeller: f.isBestSeller === true, isFlashDeal: f.isFlashDeal === true,
      createdAt, searchIndex: null
    };
    const cat = CATEGORIES.find(c => c.id === categoryId);
    product.searchIndex = {
      name: normalizeText(name), brand: normalizeText(product.brand),
      category: normalizeText(cat ? cat.name : ''), description: normalizeText(product.description)
    };
    return product;
  }

  /** A product is visible only when published, named and assigned a positive selling price. */
  function isCustomerVisible(p) {
    return p.isPublished === true && p.name !== '' && Number.isFinite(p.price) && p.price > 0;
  }

  function buildCatalogue() {
    let order = 0;
    const usedIds = new Set();
    CATEGORIES.forEach(cat => {
      const entries = PRODUCT_CATALOGUE[cat.id] || [];
      const bySlot = new Map();
      if (!Array.isArray(entries)) {
        console.warn('[ShobPaben] Product list for ' + cat.id + ' must be an array.');
        return;
      }
      entries.forEach(entry => {
        const id = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
        const match = id.match(new RegExp('^' + cat.id + '-(\\d{3})$'));
        const slot = match ? Number(match[1]) : 0;
        if (!slot || slot > SLOTS_PER_CATEGORY) {
          console.warn('[ShobPaben] Invalid or out-of-range product ID in ' + cat.id + ':', id || '(missing ID)');
          return;
        }
        if (bySlot.has(slot) || usedIds.has(id)) {
          console.warn('[ShobPaben] Duplicate product ID ignored:', id);
          return;
        }
        bySlot.set(slot, entry);
        usedIds.add(id);
      });
      for (let slot = 1; slot <= SLOTS_PER_CATEGORY; slot++) {
        const entry = bySlot.get(slot);
        const product = entry ? createProduct(cat.id, slot, entry) : createEmptySlot(cat.id, slot);
        if (!product) continue;
        product.order = order++;
        PRODUCTS.push(product);
        if (isCustomerVisible(product)) {
          PUBLIC_PRODUCTS.push(product);
          PUBLIC_BY_ID.set(product.id, product);
        } else if (entry && product.isPublished) {
          console.warn('[ShobPaben] ' + product.id + ' has no valid name or positive price and is hidden.');
        }
      }
    });
  }

  /* ======================================================================
     3. HELPERS, STORAGE, NOTIFICATIONS, IMAGE FALLBACK
     ====================================================================== */

  const byId = id => document.getElementById(id);
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const setText = (el, text) => { if (el) el.textContent = text; };
  const setHidden = (el, hidden) => { if (el) el.hidden = !!hidden; };

  const moneyFormatter = (() => {
    try { return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }); }
    catch (e) { return { format: n => String(n) }; }
  })();

  function formatMoney(amount) {
    return CONFIG.currencySymbol + ' ' + moneyFormatter.format(Math.round(Number(amount) || 0));
  }

  function toAsciiDigits(value) {
    return String(value).replace(/[\u09E6-\u09EF]/g, d => String(d.charCodeAt(0) - 0x09E6));
  }

  /** Returns the number as 01XXXXXXXXX, or null when it is not a valid Bangladesh mobile number. */
  function normalizeBdPhone(raw) {
    let v = toAsciiDigits(raw).replace(/[\s\-().]/g, '');
    if (v.startsWith('+')) v = v.slice(1);
    if (v.startsWith('00880')) v = v.slice(2);
    if (v.startsWith('880')) v = '0' + v.slice(3);
    if (/^1[3-9]\d{8}$/.test(v)) v = '0' + v;
    return /^01[3-9]\d{8}$/.test(v) ? v : null;
  }

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function safeDecode(text) {
    try { return decodeURIComponent(text); } catch (e) { return text; }
  }

  function debounce(fn, wait) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }

  function scrollToTop() {
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }
    catch (e) { window.scrollTo(0, 0); }
  }

  const prefersReducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* ---- Storage helpers (safe JSON, graceful when storage is blocked) ---- */
  const storage = (function () {
    let available = false;
    try {
      const probe = CONFIG.storagePrefix + 'probe';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      available = true;
    } catch (e) { available = false; }

    return {
      get available() { return available; },
      read(key, fallback) {
        if (!available) return fallback;
        try {
          const raw = window.localStorage.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
          console.warn('[ShobPaben] Could not read stored data for "' + key + '"; ignoring it.', e);
          return fallback;
        }
      },
      write(key, value) {
        if (!available) return false;
        try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { console.warn('[ShobPaben] Could not save "' + key + '".', e); return false; }
      }
    };
  })();

  /* ---- Notifications (toasts). The region is created here because the HTML has none. ---- */
  const toast = (function () {
    let region = null;

    function ensureRegion() {
      if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        Object.assign(region.style, {
          position: 'fixed', left: '50%', bottom: '20px', transform: 'translateX(-50%)', zIndex: '300',
          display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center',
          width: 'min(92vw, 440px)', pointerEvents: 'none'
        });
      }
      // A modal <dialog> sits in the top layer, so show messages inside it while it is open.
      const host = document.querySelector('dialog[open]') || document.body;
      if (region.parentNode !== host) host.appendChild(region);
      return region;
    }

    function show(message, options) {
      const opts = options || {};
      const type = opts.type || 'info';
      const host = ensureRegion();
      const item = document.createElement('div');
      item.setAttribute('role', type === 'error' ? 'alert' : 'status');
      Object.assign(item.style, {
        display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow-md)', fontSize: '0.9375rem', lineHeight: '1.4', color: '#fff', pointerEvents: 'auto',
        background: type === 'error' ? 'var(--error)' : (type === 'success' ? 'var(--brand)' : 'var(--text)')
      });
      const text = document.createElement('span');
      const displayMessage = activeLanguage === 'bn' ? (BENGALI_MESSAGES[message] || message) : message;
      text.textContent = displayMessage;
      item.appendChild(text);

      let timer = null;
      const dismiss = () => { clearTimeout(timer); if (item.parentNode) item.parentNode.removeChild(item); };

      if (opts.action && opts.action.label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = activeLanguage === 'bn' ? (BENGALI_MESSAGES[opts.action.label] || opts.action.label) : opts.action.label;
        Object.assign(btn.style, {
          flex: 'none', padding: '0', border: '0', background: 'transparent', color: '#fff',
          font: 'inherit', fontWeight: '700', textDecoration: 'underline', cursor: 'pointer'
        });
        btn.addEventListener('click', () => { dismiss(); opts.action.onClick(); });
        item.appendChild(btn);
      }
      item.addEventListener('click', e => { if (e.target === item || e.target === text) dismiss(); });

      host.appendChild(item);
      while (host.children.length > 3) host.removeChild(host.firstChild);
      timer = setTimeout(dismiss, opts.duration || CONFIG.toastMs);
      return dismiss;
    }
    return { show };
  })();

  /* ---- Image fallback: placeholder file first, then an inline neutral image ---- */
  function setImage(img, src, alt) {
    if (!img) return;
    img.dataset.fbStep = '0';
    img.src = src || PLACEHOLDER_IMAGE;
    if (alt !== undefined) img.alt = alt;
  }

  function handleImageError(img) {
    const step = Number(img.dataset.fbStep || 0);
    const isEditorialImage = img.matches('.hero-image, .category-image');
    const current = img.getAttribute('src');
    if (step === 0 && !isEditorialImage && current !== PLACEHOLDER_IMAGE) {
      img.dataset.fbStep = '1';
      img.src = PLACEHOLDER_IMAGE;
    } else if (step < 2 && current !== FALLBACK_IMAGE) {
      img.dataset.fbStep = '2';
      img.src = FALLBACK_IMAGE;
    }
  }

  function setupImageFallbacks() {
    document.addEventListener('error', e => {
      if (e.target && e.target.tagName === 'IMG') handleImageError(e.target);
    }, true);
    // Images that already failed before this script ran.
    $$('img').forEach(img => {
      if (img.getAttribute('src') && img.complete && img.naturalWidth === 0) handleImageError(img);
    });
  }

  /* ======================================================================
     4. STATE & DOM REFERENCES
     ====================================================================== */

  const state = {
    route: { name: 'home', pageId: 'home-page' },
    lastBrowsePath: '',
    pendingScrollId: '',
    cart: { lines: [], couponCode: '' },
    wishlist: [],
    orders: [],
    pendingOrder: null,
    lastOrderId: '',
    flashExpired: false,
    listing: { key: null, ctx: null, visible: CONFIG.pageSize, rendered: 0 },
    detail: { productId: '', qty: 1, selections: {} },
    quickView: { productId: '', qty: 1 },
    isPlacingOrder: false,
    invoiceDialog: null,
    invoicePlaceholder: null,
    invoicePreviousFocus: null,
    invoiceBodyOverflow: '',
    lastOrderAt: 0,
    storageNoticeShown: false
  };

  const dom = {};
  let activeLanguage = 'en';
  const GOOGLE_SHEETS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwTNN6CIWCxGtN4IK1a_RZIZc3EjT76eTaQB_itq11q4PJzNMCAhVM3qsoPOsxseFtEHw/exec'; // Supplied endpoint; use the deployment for the matching Code.gs.

  const STATIC_TRANSLATIONS = [
    ['#announcement-message', 'Explore our latest offers.', 'আমাদের সর্বশেষ অফারগুলো দেখুন।', 'text'],
    ['#announcement-bar .announcement-action', 'View Offers', 'অফার দেখুন', 'text'],
    ['#product-search-input', 'Search products', 'পণ্য খুঁজুন', 'placeholder'],
    ['#product-search-form button[type="submit"] .button-text', 'Search', 'খুঁজুন', 'text'],
    ['#header-wishlist-link .header-link-label', 'Wishlist', 'ইচ্ছেতালিকা', 'text'],
    ['#header-account-link .header-link-label', 'Account', 'অ্যাকাউন্ট', 'text'],
    ['#cart-button .cart-label', 'Cart', 'কার্ট', 'text'],
    ['#hamburger-button', 'Open menu', 'মেনু খুলুন', 'aria-label'],
    ['#main-navigation-menu .menu-title', 'Menu', 'মেনু', 'text'],
    ['#menu-close-button', 'Close main menu', 'মেনু বন্ধ করুন', 'aria-label'],
    ['#main-navigation-menu a[data-page="home-page"]', 'Home', 'হোম', 'text'],
    ['#main-navigation-menu a[data-category="electronics"]', 'Electronics & Gadgets', 'ইলেকট্রনিক্স ও গ্যাজেটস', 'text'],
    ['#main-navigation-menu a[data-category="home-kitchen"]', 'Home & Kitchen', 'ঘর ও রান্নাঘর', 'text'],
    ['#main-navigation-menu a[data-category="beauty"]', 'Beauty & Personal Care', 'সৌন্দর্য ও ব্যক্তিগত পরিচর্যা', 'text'],
    ['#main-navigation-menu a[data-category="fashion"]', 'Games & Toys', 'গেমস ও খেলনা', 'text'],
    ['#main-navigation-menu a[data-category="baby-kids"]', 'Baby & Kids', 'শিশু ও কিডস', 'text'],
    ['#main-navigation-menu a[data-action="open-cart"]', 'Cart', 'কার্ট', 'text'],
    ['#main-navigation-menu a[data-page="wishlist-page"]', 'Wishlist', 'ইচ্ছেতালিকা', 'text'],
    ['#main-navigation-menu a[data-page="account-page"]', 'Account', 'অ্যাকাউন্ট', 'text'],
    ['#main-navigation-menu a[data-page="contact-page"]', 'Contact', 'যোগাযোগ', 'text'],
    ['#main-navigation-menu a[data-page="home-page"]', 'Home', 'হোম', 'text'],
    ['#main-navigation-menu a[data-category="electronics"]', 'Electronics & Gadgets', 'ইলেকট্রনিক্স ও গ্যাজেটস', 'text'],
    ['#main-navigation-menu a[data-category="home-kitchen"]', 'Home & Kitchen', 'ঘর ও রান্নাঘর', 'text'],
    ['#main-navigation-menu a[data-category="beauty"]', 'Beauty & Personal Care', 'সৌন্দর্য ও ব্যক্তিগত পরিচর্যা', 'text'],
    ['#main-navigation-menu a[data-category="fashion"]', 'Games & Toys', 'গেমস ও খেলনা', 'text'],
    ['#main-navigation-menu a[data-category="baby-kids"]', 'Baby & Kids', 'শিশু ও কিডস', 'text'],
    ['#main-navigation-menu a[data-action="open-cart"]', 'Cart', 'কার্ট', 'text'],
    ['#main-navigation-menu a[data-page="wishlist-page"]', 'Wishlist', 'ইচ্ছেতালিকা', 'text'],
    ['#main-navigation-menu a[data-page="account-page"]', 'Account', 'অ্যাকাউন্ট', 'text'],
    ['#main-navigation-menu a[data-page="contact-page"]', 'Contact', 'যোগাযোগ', 'text'],
    ['#shop-by-category-heading', 'Shop by Category', 'ক্যাটাগরি অনুযায়ী কেনাকাটা', 'text'],
    ['#shop-by-category-section .section-subtitle', 'Browse our five main categories.', 'আমাদের পাঁচটি প্রধান ক্যাটাগরি দেখুন।', 'text'],
    ['#flash-deals .section-subtitle', 'Limited-time offers on selected products.', 'নির্বাচিত পণ্যে সীমিত সময়ের অফার।', 'text'],
    ['#electronics-section .section-subtitle', 'Smart devices, accessories and everyday gadgets.', 'স্মার্ট ডিভাইস, অ্যাক্সেসরিজ ও দৈনন্দিন গ্যাজেট।', 'text'],
    ['#home-kitchen-section .section-subtitle', 'Cookware, storage and useful household items.', 'রান্নার সামগ্রী, সংরক্ষণ ও ঘরের প্রয়োজনীয় জিনিস।', 'text'],
    ['#beauty-section .section-subtitle', 'Skincare, grooming and personal care essentials.', 'ত্বকের যত্ন, গ্রুমিং ও ব্যক্তিগত পরিচর্যার প্রয়োজনীয় পণ্য।', 'text'],
    ['#fashion-section .section-subtitle', 'Board games, puzzles and creative toys for every age.', 'বোর্ড গেম, পাজল ও সব বয়সের জন্য সৃজনশীল খেলনা।', 'text'],
    ['#baby-kids-section .section-subtitle', 'Everyday products for babies, toddlers and children.', 'শিশু ও বাচ্চাদের দৈনন্দিন প্রয়োজনীয় পণ্য।', 'text'],
    ['#new-arrivals .section-subtitle', 'Recently added products.', 'সম্প্রতি যুক্ত হওয়া পণ্য।', 'text'],
    ['#best-sellers .section-subtitle', 'Popular products, shown when real sales data is available.', 'প্রকৃত বিক্রির তথ্য থাকলে জনপ্রিয় পণ্য দেখানো হবে।', 'text'],
    ['.view-all-categories', 'View All Products', 'সব পণ্য দেখুন', 'text'],
    ['.view-all-link[data-category="all-deals"]', 'View All Deals', 'সব অফার দেখুন', 'text'],
    ['.view-all-link[data-category="electronics"], .view-all-link[data-category="home-kitchen"], .view-all-link[data-category="beauty"], .view-all-link[data-category="fashion"], .view-all-link[data-category="baby-kids"], .view-all-link[data-category="new-arrivals"], .view-all-link[data-category="best-sellers"]', 'View All', 'সব দেখুন', 'text'],
    ['.category-action', 'View Category', 'ক্যাটাগরি দেখুন', 'text'],
    ['#electronics-section-heading', 'Electronics & Gadgets', 'ইলেকট্রনিক্স ও গ্যাজেটস', 'text'],
    ['#home-kitchen-section-heading', 'Home & Kitchen', 'ঘর ও রান্নাঘর', 'text'],
    ['#beauty-section-heading', 'Beauty & Personal Care', 'সৌন্দর্য ও ব্যক্তিগত পরিচর্যা', 'text'],
    ['#fashion-section-heading', 'Games & Toys', 'গেমস ও খেলনা', 'text'],
    ['#baby-kids-section-heading', 'Baby & Kids', 'শিশু ও কিডস', 'text'],
    ['#category-filters-form #category-stock-filter option[value="all"]', 'All', 'সব', 'text'],
    ['#category-filters-form #category-stock-filter option[value="in-stock"]', 'In stock', 'স্টকে আছে', 'text'],
    ['#category-filters-form #category-stock-filter option[value="out-of-stock"]', 'Out of stock', 'স্টকে নেই', 'text'],
    ['#category-filters-form #category-sort option[value="featured"]', 'Featured', 'বিশেষভাবে নির্বাচিত', 'text'],
    ['#category-filters-form #category-sort option[value="newest"]', 'Newest', 'নতুন', 'text'],
    ['#category-filters-form #category-sort option[value="price-asc"]', 'Price: Low to High', 'মূল্য: কম থেকে বেশি', 'text'],
    ['#category-filters-form #category-sort option[value="price-desc"]', 'Price: High to Low', 'মূল্য: বেশি থেকে কম', 'text'],
    ['#category-load-more', 'Load More Products', 'আরও পণ্য দেখুন', 'text'],
    ['#detail-product-name', 'Product name', 'পণ্যের নাম', 'text'],
    ['#detail-product-stock', 'Stock status', 'স্টকের অবস্থা', 'text'],
    ['#detail-product-description', 'Product description appears here.', 'পণ্যের বিবরণ এখানে দেখানো হবে।', 'text'],
    ['#detail-add-to-cart', 'Add to Cart', 'কার্টে যোগ করুন', 'text'],
    ['#detail-buy-now', 'Buy Now', 'এখনই কিনুন', 'text'],
    ['#detail-wishlist .button-text', 'Wishlist', 'ইচ্ছেতালিকা', 'text'],
    ['#quick-view-details-link', 'View Full Details', 'সম্পূর্ণ বিবরণ দেখুন', 'text'],
    ['#quick-view-add-to-cart', 'Add to Cart', 'কার্টে যোগ করুন', 'text'],
    ['.back-link', 'Back to Home', 'হোমে ফিরুন', 'text'],
    ['.continue-shopping-link', 'Continue Shopping', 'কেনাকাটা চালিয়ে যান', 'text'],
    ['#invoice-customer-heading', 'Customer Information', 'গ্রাহকের তথ্য', 'text'],
    ['#invoice-address-heading', 'Delivery Address', 'ডেলিভারির ঠিকানা', 'text'],
    ['#confirmation-continue-shopping', 'Continue Shopping', 'কেনাকাটা চালিয়ে যান', 'text'],
    ['.contact-support-button', 'Contact Support', 'সহায়তায় যোগাযোগ করুন', 'text'],
    ['#whatsapp-order-button', 'WhatsApp Order Inquiry', 'WhatsApp-এ অর্ডার সম্পর্কে জিজ্ঞাসা করুন', 'text'],
    ['.contact-whatsapp-link', 'Chat on WhatsApp: +8801355514101', 'WhatsApp-এ চ্যাট করুন: +8801355514101', 'text'],
    ['.footer-description', 'ShobPaben.online is an online shopping website for customers in Bangladesh.', 'ShobPaben.online বাংলাদেশের গ্রাহকদের জন্য একটি অনলাইন শপিং ওয়েবসাইট।', 'text'],
    ['#footer-newsletter-heading', 'Newsletter', 'নিউজলেটার', 'text'],
    ['#newsletter-consent + label', 'I agree to receive promotional emails from ShobPaben.online and understand I can unsubscribe at any time.', 'আমি ShobPaben.online থেকে প্রচারমূলক ইমেইল পেতে সম্মত এবং যেকোনো সময় আনসাবস্ক্রাইব করতে পারি।', 'text'],
    ['#hero-carousel-heading', 'Featured promotions', 'বিশেষ প্রচারণা', 'text'],
    ['#hero-slide-1 .hero-title', 'Discover Everyday Essentials', 'প্রতিদিনের প্রয়োজনীয় পণ্য খুঁজুন', 'text'],
    ['#hero-slide-1 .hero-description', 'Find the daily products you need, all in one place.', 'প্রতিদিনের প্রয়োজনীয় সব পণ্য এক জায়গায় পান।', 'text'],
    ['#hero-slide-1 .hero-cta', 'Shop Essentials', 'প্রয়োজনীয় পণ্য কিনুন', 'text'],
    ['#hero-slide-2 .hero-description', 'Explore smart devices and accessories for work and play.', 'কাজ ও বিনোদনের স্মার্ট ডিভাইস ও অ্যাক্সেসরিজ দেখুন।', 'text'],
    ['#hero-slide-2 .hero-cta', 'Shop Electronics', 'ইলেকট্রনিক্স কিনুন', 'text'],
    ['#hero-slide-3 .hero-title', 'Upgrade Your Home & Kitchen', 'ঘর ও রান্নাঘর সাজান', 'text'],
    ['#hero-slide-3 .hero-description', 'Practical items to make your home more comfortable.', 'ঘরকে আরও আরামদায়ক করতে প্রয়োজনীয় পণ্য।', 'text'],
    ['#hero-slide-3 .hero-cta', 'Shop Home & Kitchen', 'ঘর ও রান্নাঘরের পণ্য কিনুন', 'text'],
    ['#hero-slide-4 .hero-title', 'Games & Toys', 'গেমস ও খেলনা', 'text'],
    ['#hero-slide-4 .hero-description', 'Discover fun games, creative toys and exciting picks for every age.', 'সব বয়সের জন্য মজার গেম, সৃজনশীল খেলনা ও দারুণ সব পছন্দ দেখুন।', 'text'],
    ['#hero-slide-4 .hero-cta', 'Shop Games & Toys', 'গেমস ও খেলনা কিনুন', 'text'],
    ['#hero-slide-5 .hero-title', 'Beauty & Personal Care', 'সৌন্দর্য ও ব্যক্তিগত পরিচর্যা', 'text'],
    ['#hero-slide-5 .hero-cta', 'Shop Beauty', 'বিউটি পণ্য কিনুন', 'text'],
        ['#category-search-input', 'Search products', 'পণ্য খুঁজুন', 'placeholder'],
    ['#category-price-range legend', 'Price range (৳)', 'দামের সীমা (৳)', 'text'],
    ['#category-price-range label[for="category-min-price-range"]', 'Minimum price slider (৳)', 'সর্বনিম্ন মূল্য স্লাইডার (৳)', 'text'],
    ['#category-price-range label[for="category-max-price-range"]', 'Maximum price slider (৳)', 'সর্বোচ্চ মূল্য স্লাইডার (৳)', 'text'],
    ['#category-min-price', 'Min', 'সর্বনিম্ন', 'placeholder'],
    ['#category-max-price', 'Max', 'সর্বোচ্চ', 'placeholder'],
    ['#category-filters-form [for="category-search-input"]', 'Search in this category', 'এই ক্যাটাগরিতে খুঁজুন', 'text'],
    ['#category-filters-form [for="category-min-price"]', 'Minimum price (৳)', 'সর্বনিম্ন মূল্য (৳)', 'text'],
    ['#category-filters-form [for="category-max-price"]', 'Maximum price (৳)', 'সর্বোচ্চ মূল্য (৳)', 'text'],
    ['#category-filters-form [for="category-stock-filter"]', 'Availability', 'প্রাপ্যতা', 'text'],
    ['#category-filters-form [for="category-sort"]', 'Sort by', 'সাজান', 'text'],
    ['#category-empty-state p', 'No products match your search or filters.', 'আপনার খোঁজ বা ফিল্টারের সঙ্গে মেলে এমন পণ্য নেই।', 'text'],
    ['#category-load-more', 'Load More Products', 'আরও পণ্য দেখুন', 'text'],
    ['#cart-empty-state p', 'Your cart is empty.', 'আপনার কার্ট খালি।', 'text'],
    ['#cart-empty-state a', 'Start Shopping', 'কেনাকাটা শুরু করুন', 'text'],
    ['#proceed-to-checkout', 'Proceed to Checkout', 'চেকআউটে যান', 'text'],
    ['#wishlist-empty-state p', 'Your wishlist is empty.', 'আপনার ইচ্ছেতালিকা খালি।', 'text'],
    ['#account-title', 'My Account', 'আমার অ্যাকাউন্ট', 'text'],
    ['#account-empty-state p', 'Account features are not available yet.', 'অ্যাকাউন্টের সুবিধা এখনো চালু হয়নি।', 'text'],
    ['#order-history-title', 'Order History', 'অর্ডারের ইতিহাস', 'text'],
    ['#order-history-empty-state p', 'You have no orders yet.', 'আপনার এখনো কোনো অর্ডার নেই।', 'text'],
    ['#about-title', 'About ShobPaben', 'ShobPaben সম্পর্কে', 'text'],
    ['#contact-title', 'Contact Us', 'যোগাযোগ করুন', 'text'],
    ['#newsletter-form input[type="email"]', 'Email address', 'ইমেইল ঠিকানা', 'placeholder'],
    ['.skip-link', 'Skip to main content', 'মূল কনটেন্টে যান', 'text'],
    ['#announcement-close', 'Close announcement bar', 'ঘোষণাটি বন্ধ করুন', 'aria-label'],
    ['#shop-by-category-heading', 'Shop by Category', 'ক্যাটাগরি অনুযায়ী কেনাকাটা', 'text'],
    ['#view-all-category', 'View All Products', 'সব পণ্য দেখুন', 'text'],
    ['#flash-deals-heading', 'Flash Deals', 'ফ্ল্যাশ ডিল', 'text'],
    ['#new-arrivals-heading', 'New Arrivals', 'নতুন পণ্য', 'text'],
    ['#new-arrivals-empty', 'New products will appear here soon.', 'নতুন পণ্য শিগগিরই এখানে দেখা যাবে।', 'text'],
    ['#best-sellers-heading', 'Best Sellers', 'বেস্ট সেলার', 'text'],
    ['#best-sellers-empty', 'Best sellers will appear here soon.', 'বেস্ট সেলার পণ্য শিগগিরই এখানে দেখা যাবে।', 'text'],
    ['#why-shop-heading', 'Why Shop With Us', 'কেন আমাদের কাছ থেকে কিনবেন', 'text'],
    ['#customer-support-heading', 'Customer Support', 'গ্রাহক সহায়তা', 'text'],
    ['.support-contact-link', 'Go to Contact Page', 'যোগাযোগ পৃষ্ঠায় যান', 'text'],
    ['#clear-category-filters', 'Clear Filters', 'ফিল্টার মুছুন', 'text'],
    ['#cart-title', 'Shopping Cart', 'কেনাকাটার কার্ট', 'text'],
    ['#cart-summary-heading', 'Order Summary', 'অর্ডারের সারাংশ', 'text'],
    ['#apply-coupon-button', 'Apply Coupon', 'কুপন প্রয়োগ করুন', 'text'],
    ['#checkout-title', 'Checkout', 'চেকআউট', 'text'],
    ['#order-confirmation-title', 'Order Placed Successfully', 'অর্ডার সফলভাবে সম্পন্ন হয়েছে', 'text'],
    ['#invoice-heading', 'Invoice', 'ইনভয়েস', 'text'],
    ['#print-invoice-button', 'Print Invoice', 'ইনভয়েস প্রিন্ট করুন', 'text'],
    ['#wishlist-title', 'My Wishlist', 'আমার ইচ্ছেতালিকা', 'text'],
    ['#contact-submit', 'Send Message', 'বার্তা পাঠান', 'text'],
    ['#footer-quick-links-heading', 'Quick Links', 'দ্রুত লিংক', 'text'],
    ['#footer-categories-heading', 'Categories', 'ক্যাটাগরি', 'text'],
    ['#footer-policies-heading', 'Policies', 'নীতিমালা', 'text'],
    ['#footer-contact-heading', 'Contact', 'যোগাযোগ', 'text'],
    ['#footer-newsletter-heading', 'Newsletter', 'নিউজলেটার', 'text'],
    ['#newsletter-form button[type="submit"]', 'Subscribe', 'সাবস্ক্রাইব', 'text']
  ];

  const BENGALI_MESSAGES = {
    'That category was not found.': 'ক্যাটাগরিটি পাওয়া যায়নি।',
    'This product is not available.': 'এই পণ্যটি পাওয়া যাচ্ছে না।',
    'Your cart is empty. Add a product before checking out.': 'আপনার কার্ট খালি। চেকআউটের আগে একটি পণ্য যোগ করুন।',
    'That category is not available.': 'ক্যাটাগরিটি পাওয়া যাচ্ছে না।',
    'This page is not available yet. Please contact us on WhatsApp for help.': 'এই পৃষ্ঠাটি এখনো পাওয়া যাচ্ছে না। সহায়তার জন্য WhatsApp-এ যোগাযোগ করুন।',
    'Your browser is blocking saved data, so the cart will be lost if you refresh the page.': 'আপনার ব্রাউজার তথ্য সংরক্ষণে বাধা দিচ্ছে, তাই পৃষ্ঠা রিফ্রেশ করলে কার্ট হারিয়ে যাবে।',
    'Sorry, this product is out of stock.': 'দুঃখিত, এই পণ্যটি স্টকে নেই।',
    'Please choose all product options first.': 'আগে পণ্যের সব বিকল্প নির্বাচন করুন।',
    'Coupon removed.': 'কুপন সরানো হয়েছে।',
    'Enter a coupon code first.': 'আগে কুপন কোড লিখুন।',
    'Add a product to your cart before applying a coupon.': 'কুপন প্রয়োগের আগে কার্টে একটি পণ্য যোগ করুন।',
    'Your cart is empty.': 'আপনার কার্ট খালি।',
    'Please choose your options, then add to cart.': 'বিকল্পগুলো নির্বাচন করে কার্টে যোগ করুন।',
    'Wishlist': 'ইচ্ছেতালিকা', 'Saved': 'সংরক্ষিত',
    'View Cart': 'কার্ট দেখুন', 'Remove': 'সরান',
    'Please fix the highlighted fields.': 'চিহ্নিত ঘরগুলোর তথ্য ঠিক করুন।',
    'Please choose Cash on Delivery. No other payment method is available yet.': 'ক্যাশ অন ডেলিভারি নির্বাচন করুন। অন্য কোনো পেমেন্ট পদ্ধতি এখনো চালু নেই।',
    'There is no invoice to print yet.': 'প্রিন্ট করার মতো কোনো ইনভয়েস এখনো নেই।',
    'Newsletter sign-up is not available yet. Your email was not saved.': 'নিউজলেটার সাবস্ক্রিপশন এখনো চালু নেই। আপনার ইমেইল সংরক্ষণ করা হয়নি।'
  };

  const STATIC_TEXT_TRANSLATIONS = {
    'Skip to main content': 'মূল কনটেন্টে যান', 'Showing': 'দেখানো হচ্ছে', 'published products': 'প্রকাশিত পণ্য', 'View Offers': 'অফার দেখুন', 'Search products': 'পণ্য খুঁজুন',
    'Search for products, brands and more...': 'পণ্য, ব্র্যান্ড ও আরও খুঁজুন...', 'Search in this category': 'এই ক্যাটাগরিতে খুঁজুন',
    'Minimum price (৳)': 'সর্বনিম্ন মূল্য (৳)', 'Maximum price (৳)': 'সর্বোচ্চ মূল্য (৳)', 'Availability': 'প্রাপ্যতা',
    'Sort by': 'সাজান', 'All': 'সব', 'In stock': 'স্টকে আছে', 'Out of stock': 'স্টকে নেই',
    'Featured': 'বিশেষভাবে নির্বাচিত', 'Newest': 'নতুন', 'Price: Low to High': 'মূল্য: কম থেকে বেশি', 'Price: High to Low': 'মূল্য: বেশি থেকে কম',
    'Clear Filters': 'ফিল্টার মুছুন', 'No products match your search or filters.': 'আপনার খোঁজ বা ফিল্টারের সঙ্গে মেলে এমন পণ্য নেই।',
    'Load More Products': 'আরও পণ্য দেখুন', 'Back to Home': 'হোমে ফিরুন', 'Product ID:': 'পণ্য আইডি:', 'Category': 'ক্যাটাগরি',
    'Description': 'বিবরণ', 'Specifications': 'বৈশিষ্ট্য', 'Delivery Information': 'ডেলিভারি তথ্য', 'Warranty Information': 'ওয়ারেন্টি তথ্য',
    'Return Policy': 'রিটার্ন নীতিমালা', 'Add to Cart': 'কার্টে যোগ করুন', 'Buy Now': 'এখনই কিনুন', 'View Full Details': 'সম্পূর্ণ বিবরণ দেখুন',
    'Related Products': 'সংশ্লিষ্ট পণ্য', 'Shopping Cart': 'কেনাকাটার কার্ট', 'Your cart is empty.': 'আপনার কার্ট খালি।',
    'Start Shopping': 'কেনাকাটা শুরু করুন', 'Continue Shopping': 'কেনাকাটা চালিয়ে যান', 'Order Summary': 'অর্ডারের সারাংশ',
    'Coupon code': 'কুপন কোড', 'Apply Coupon': 'কুপন প্রয়োগ করুন', 'Proceed to Checkout': 'চেকআউটে যান', 'Checkout': 'চেকআউট',
    'Full name': 'পূর্ণ নাম', 'Mobile number': 'মোবাইল নম্বর', 'Division': 'বিভাগ', 'District': 'জেলা', 'Upazila or area': 'উপজেলা বা এলাকা',
    'Detailed delivery address': 'বিস্তারিত ডেলিভারি ঠিকানা', 'Delivery instructions (optional)': 'ডেলিভারির নির্দেশনা (ঐচ্ছিক)',
    'Payment Method': 'পেমেন্ট পদ্ধতি', 'Cash on Delivery': 'ক্যাশ অন ডেলিভারি', 'Online payment (placeholder, not yet available)': 'অনলাইন পেমেন্ট (এখনো চালু হয়নি)',
    'I have read and agree to the Terms & Conditions and Return & Refund Policy.': 'আমি শর্তাবলি এবং রিটার্ন ও রিফান্ড নীতিমালা পড়েছি ও সম্মত হয়েছি।',
    'Return to Cart': 'কার্টে ফিরুন', 'Place Order': 'অর্ডার করুন', 'Order Placed Successfully': 'অর্ডার সফলভাবে সম্পন্ন হয়েছে',
    'Thank you for shopping with ShobPaben.': 'ShobPaben থেকে কেনাকাটার জন্য ধন্যবাদ।', 'Invoice': 'ইনভয়েস', 'Order ID:': 'অর্ডার আইডি:',
    'Order date:': 'অর্ডারের তারিখ:', 'Customer Information': 'গ্রাহকের তথ্য', 'Delivery Address': 'ডেলিভারির ঠিকানা', 'Payment method:': 'পেমেন্ট পদ্ধতি:',
    'Print Invoice': 'ইনভয়েস প্রিন্ট করুন', 'Contact Support': 'সহায়তায় যোগাযোগ করুন', 'WhatsApp Order Inquiry': 'WhatsApp-এ অর্ডার সম্পর্কে জিজ্ঞাসা করুন',
    'My Wishlist': 'আমার ইচ্ছেতালিকা', 'Your wishlist is empty.': 'আপনার ইচ্ছেতালিকা খালি।', 'Wishlist': 'ইচ্ছেতালিকা',
    'My Account': 'আমার অ্যাকাউন্ট', 'Account features are not available yet.': 'অ্যাকাউন্টের সুবিধা এখনো চালু হয়নি।', 'View Order History': 'অর্ডারের ইতিহাস দেখুন',
    'Order History': 'অর্ডারের ইতিহাস', 'You have no orders yet.': 'আপনার এখনো কোনো অর্ডার নেই।', 'About ShobPaben': 'ShobPaben সম্পর্কে',
    'Who We Are': 'আমরা কারা', 'Our Mission': 'আমাদের লক্ষ্য', 'Our Values': 'আমাদের মূল্যবোধ', 'Customer-First Philosophy': 'গ্রাহককে অগ্রাধিকার দেওয়ার দর্শন',
    'Contact Us': 'যোগাযোগ করুন', 'Our customer support team is ready to help with product and order questions.': 'পণ্য ও অর্ডার-সংক্রান্ত প্রশ্নে আমাদের গ্রাহক সহায়তা দল সাহায্য করতে প্রস্তুত।',
    'Name': 'নাম', 'Phone or email': 'ফোন বা ইমেইল', 'Subject': 'বিষয়', 'Message': 'বার্তা', 'Send Message': 'বার্তা পাঠান',
    'Quick Links': 'দ্রুত লিংক', 'About Us': 'আমাদের সম্পর্কে', 'Order Tracking': 'অর্ডার ট্র্যাকিং', 'Customer Support': 'গ্রাহক সহায়তা',
    'Categories': 'ক্যাটাগরি', 'Policies': 'নীতিমালা', 'Delivery Policy': 'ডেলিভারি নীতিমালা', 'Return & Refund Policy': 'রিটার্ন ও রিফান্ড নীতিমালা',
    'Privacy Policy': 'গোপনীয়তা নীতিমালা', 'Terms & Conditions': 'শর্তাবলি', 'Contact': 'যোগাযোগ', 'Newsletter': 'নিউজলেটার',
    'Email address': 'ইমেইল ঠিকানা', 'Subscribe': 'সাবস্ক্রাইব', 'View Category': 'ক্যাটাগরি দেখুন', 'View All Products': 'সব পণ্য দেখুন',
    'View All Deals': 'সব অফার দেখুন', 'View All': 'সব দেখুন', 'Shop by Category': 'ক্যাটাগরি অনুযায়ী কেনাকাটা',
    'Flash Deals': 'ফ্ল্যাশ ডিল', 'New Arrivals': 'নতুন পণ্য', 'Best Sellers': 'বেস্ট সেলার', 'Why Shop With Us': 'কেন আমাদের কাছ থেকে কিনবেন',
    'Convenient Shopping': 'সহজে কেনাকাটা', 'Reliable Customer Support': 'নির্ভরযোগ্য গ্রাহক সহায়তা', 'Clear Pricing': 'স্বচ্ছ মূল্য',
    'Delivery details are displayed at checkout before you place an order.': 'অর্ডার দেওয়ার আগে চেকআউটে ডেলিভারির তথ্য দেখানো হয়।',
    'Browse our five main categories.': 'আমাদের পাঁচটি প্রধান ক্যাটাগরি দেখুন।', 'Limited-time offers on selected products.': 'নির্বাচিত পণ্যে সীমিত সময়ের অফার।',
    'Smart devices, accessories and everyday gadgets.': 'স্মার্ট ডিভাইস, অ্যাক্সেসরিজ ও দৈনন্দিন গ্যাজেট।',
    'Cookware, storage and useful household items.': 'রান্নার সামগ্রী, সংরক্ষণ ও ঘরের প্রয়োজনীয় জিনিস।',
    'Skincare, grooming and personal care essentials.': 'ত্বকের যত্ন, গ্রুমিং ও ব্যক্তিগত পরিচর্যার প্রয়োজনীয় পণ্য।',
    'Board games, puzzles and creative toys for every age.': 'বোর্ড গেম, পাজল ও সব বয়সের জন্য সৃজনশীল খেলনা।',
    'Everyday products for babies, toddlers and children.': 'শিশু ও বাচ্চাদের দৈনন্দিন প্রয়োজনীয় পণ্য।',
    'Recently added products.': 'সম্প্রতি যুক্ত হওয়া পণ্য।', 'Popular products, shown when real sales data is available.': 'প্রকৃত বিক্রির তথ্য থাকলে জনপ্রিয় পণ্য দেখানো হবে।',
    'New products will appear here soon.': 'নতুন পণ্য শিগগিরই এখানে দেখা যাবে।', 'Best sellers will appear here soon.': 'বেস্ট সেলার পণ্য শিগগিরই এখানে দেখা যাবে।',
    'Convenient Shopping': 'সহজে কেনাকাটা', 'Browse five product categories and find what you need easily.': 'পাঁচটি পণ্য ক্যাটাগরি ঘুরে সহজেই প্রয়োজনীয় জিনিস খুঁজুন।',
    'Reach our team through WhatsApp or the contact form.': 'WhatsApp বা যোগাযোগ ফর্মের মাধ্যমে আমাদের সঙ্গে যোগাযোগ করুন।',
    'Prices are shown in Bangladeshi Taka (৳) with totals before you order.': 'অর্ডারের আগে মোটসহ মূল্য বাংলাদেশি টাকায় (৳) দেখানো হয়।',
    'Have a question about a product or an order? Message us on WhatsApp.': 'পণ্য বা অর্ডার সম্পর্কে প্রশ্ন আছে? WhatsApp-এ বার্তা দিন।',
    'Go to Contact Page': 'যোগাযোগ পৃষ্ঠায় যান', 'Open WhatsApp with Order Details': 'অর্ডারের বিবরণসহ WhatsApp খুলুন',
    'Newsletter sign-up is not available yet. Your email was not saved.': 'নিউজলেটার সাবস্ক্রিপশন এখনো চালু নেই। আপনার ইমেইল সংরক্ষণ করা হয়নি.'
  };

  STATIC_TEXT_TRANSLATIONS['Online shopping in Bangladesh — ShobPaben.online'] =
    'বাংলাদেশে অনলাইন কেনাকাটা — ShobPaben.online';

  const originalStaticText = new WeakMap();

  function applyStaticLanguage() {
    STATIC_TRANSLATIONS.forEach(([selector, english, bangla, kind]) => {
      const nodes = document.querySelectorAll(selector);
      const value = activeLanguage === 'bn' ? bangla : english;
      nodes.forEach(node => {
        if (kind === 'placeholder' || kind === 'aria-label') {
          node.setAttribute(kind === 'placeholder' ? 'placeholder' : 'aria-label', value);
        } else {
          // Update only the direct text node of this explicitly named control; preserve nested icons and markup.
          let textNode = Array.from(node.childNodes).find(child => child.nodeType === 3 && child.nodeValue.trim());
          if (textNode) {
            if (!originalStaticText.has(textNode)) originalStaticText.set(textNode, textNode.nodeValue);
            const original = originalStaticText.get(textNode);
            const leading = (original.match(/^\s*/) || [''])[0];
            const trailing = (original.match(/\s*$/) || [''])[0];
            textNode.nodeValue = leading + value + trailing;
          } else if (!node.children.length) {
            if (!originalStaticText.has(node)) originalStaticText.set(node, node.textContent);
            node.textContent = value;
          }
        }
      });
    });
    // Translate only exact, explicitly listed English text nodes; never rewrite arbitrary content.
    const reverseStatic = Object.create(null);
    Object.keys(STATIC_TEXT_TRANSLATIONS).forEach(en => { reverseStatic[STATIC_TEXT_TRANSLATIONS[en]] = en; });
    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,template,textarea,input,select,option')) return NodeFilter.FILTER_REJECT;
        const original = originalStaticText.has(node) ? originalStaticText.get(node).trim() : node.nodeValue.trim();
        return (STATIC_TEXT_TRANSLATIONS[original] || reverseStatic[original]) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      if (!originalStaticText.has(node)) originalStaticText.set(node, node.nodeValue);
      const original = originalStaticText.get(node);
      const trimmed = original.trim();
      const translation = STATIC_TEXT_TRANSLATIONS[trimmed];
      const english = translation ? trimmed : (reverseStatic[trimmed] || trimmed);
      const leading = (original.match(/^\s*/) || [''])[0];
      const trailing = (original.match(/\s*$/) || [''])[0];
      node.nodeValue = leading + (activeLanguage === 'bn' ? (STATIC_TEXT_TRANSLATIONS[english] || english) : english) + trailing;
    });
    document.documentElement.lang = activeLanguage === 'bn' ? 'bn' : 'en';
    if (dom.languageSelector) dom.languageSelector.value = activeLanguage;
  }

  function setLanguage(value, rerender) {
    activeLanguage = value === 'bn' ? 'bn' : 'en';
    storage.write(KEYS.language, activeLanguage);
    applyStaticLanguage();
    if (rerender) rerenderForLanguage();
  }

  function rerenderForLanguage() {
    const scrollY = window.scrollY;
    const active = document.activeElement;
    const focusId = active && active.id;
    const values = Array.from(document.querySelectorAll('input[id], select[id], textarea[id]')).map(el => ({
      id: el.id, value: el.value, checked: 'checked' in el ? el.checked : undefined
    }));
    const detail = Object.assign({}, state.detail, { selections: Object.assign({}, state.detail.selections) });
    const quick = Object.assign({}, state.quickView);
    const quickWasOpen = !!(dom.quickView && dom.quickView.open);
    renderRoute(false);
    if (state.route.name === 'product' && state.detail.productId === detail.productId) {
      state.detail = detail;
      if (dom.detailVariants) {
        $$('[data-variant-name]', dom.detailVariants).forEach(el => {
          if (detail.selections[el.dataset.variantName] !== undefined) el.value = detail.selections[el.dataset.variantName];
        });
      }
      updateQuantityUi('detail');
    }
    values.forEach(item => {
      const el = byId(item.id);
      if (!el) return;
      if (item.checked !== undefined) el.checked = item.checked;
      else el.value = item.value;
    });
    if (quickWasOpen && quick.productId) {
      openQuickView(quick.productId);
      state.quickView.qty = quick.qty;
      updateQuantityUi('quick');
    }
    applyStaticLanguage();
    if (state.route.name === 'category' || state.route.name === 'search') {
      syncPriceControls('init');
      refreshListing();
    }
    window.scrollTo(0, scrollY);
    if (focusId && byId(focusId)) byId(focusId).focus({ preventScroll: true });
  }

  function cacheDom() {
    const ids = {
      main: 'main-content', announcementBar: 'announcement-bar', announcementMessage: 'announcement-message',
      cartCount: 'cart-count', cartButton: 'cart-button', hamburger: 'hamburger-button',
      menu: 'main-navigation-menu', menuClose: 'menu-close-button',
      searchForm: 'product-search-form', searchInput: 'product-search-input', suggestions: 'search-suggestions',
      flashTimer: 'flash-deals-timer', flashSection: 'flash-deals', flashGrid: 'flash-deals-grid',
      newArrivalsGrid: 'new-arrivals-grid', bestSellersGrid: 'best-sellers-grid',
      categoryPage: 'category-page', categoryTitle: 'category-title', categoryDescription: 'category-description',
      categoryBreadcrumb: 'category-breadcrumb-current', categoryCount: 'category-product-count',
      filtersForm: 'category-filters-form', filterSearch: 'category-search-input', filterMin: 'category-min-price',
      filterMax: 'category-max-price', filterStock: 'category-stock-filter', filterSort: 'category-sort',
      languageSelector: 'language-selector', filterMinRange: 'category-min-price-range', filterMaxRange: 'category-max-price-range',
      categoryGrid: 'category-product-grid', categoryEmpty: 'category-empty-state', loadMore: 'category-load-more',
      detailPage: 'product-details-page', detailImage: 'detail-product-image', detailThumbs: 'detail-thumbnails',
      detailId: 'detail-product-id', detailName: 'detail-product-name', detailBrand: 'detail-product-brand',
      detailRating: 'detail-product-rating', detailPrice: 'detail-product-price', detailOriginal: 'detail-original-price',
      detailOffer: 'detail-product-offer', detailStock: 'detail-product-stock', detailDescription: 'detail-product-description',
      detailSpecs: 'detail-product-specifications', detailVariants: 'detail-variants',
      detailDelivery: 'detail-delivery-info', detailWarranty: 'detail-warranty-info', detailReturn: 'detail-return-policy',
      detailBreadcrumbCategory: 'detail-breadcrumb-category', detailBreadcrumbProduct: 'detail-breadcrumb-product',
      detailQty: 'detail-product-quantity', detailMinus: 'detail-quantity-minus', detailPlus: 'detail-quantity-plus',
      detailAdd: 'detail-add-to-cart', detailBuy: 'detail-buy-now', detailWishlist: 'detail-wishlist',
      relatedSection: 'related-products', relatedGrid: 'related-products-grid',
      quickView: 'quick-view-dialog', qvImage: 'quick-view-image', qvTitle: 'quick-view-title', qvPrice: 'quick-view-price',
      qvDescription: 'quick-view-description', qvQty: 'quick-view-quantity', qvMinus: 'quick-view-quantity-minus',
      qvPlus: 'quick-view-quantity-plus', qvLink: 'quick-view-details-link', qvAdd: 'quick-view-add-to-cart',
      cartItems: 'cart-items-container', cartEmpty: 'cart-empty-state', cartSubtotal: 'cart-subtotal',
      cartDiscount: 'cart-discount', cartDelivery: 'cart-delivery-fee', cartTotal: 'cart-grand-total',
      couponInput: 'cart-coupon-input', couponButton: 'apply-coupon-button', checkoutButton: 'proceed-to-checkout',
      checkoutForm: 'checkout-form', checkoutItems: 'checkout-items-container', checkoutSubtotal: 'checkout-subtotal',
      checkoutDiscount: 'checkout-discount', checkoutDelivery: 'checkout-delivery-fee', checkoutTotal: 'checkout-grand-total',
      division: 'customer-division', district: 'customer-district', placeOrder: 'place-order-button',
      confirmationPage: 'order-confirmation-page', invoice: 'invoice', invoiceOrderId: 'invoice-order-id',
      invoiceDate: 'invoice-order-date', invoiceCustomer: 'invoice-customer-details', invoiceAddress: 'invoice-delivery-address',
      invoicePayment: 'invoice-payment-method', invoiceItems: 'invoice-items', invoiceSubtotal: 'invoice-subtotal',
      invoiceDiscount: 'invoice-discount', invoiceDelivery: 'invoice-delivery-fee', invoiceTotal: 'invoice-grand-total',
      whatsappOrder: 'whatsapp-order-button',
      wishlistGrid: 'wishlist-items-container', wishlistEmpty: 'wishlist-empty-state',
      orderHistory: 'order-history-container', orderHistoryEmpty: 'order-history-empty-state',
      contactForm: 'contact-form', newsletterForm: 'newsletter-form',
      productTemplate: 'product-card-template', cartTemplate: 'cart-item-template'
    };
    Object.keys(ids).forEach(key => { dom[key] = byId(ids[key]); });
    dom.views = $$('.page-view');
    dom.heroSection = byId('hero-carousel');
  }

  /* ======================================================================
     5. PRODUCT RENDERING
     ====================================================================== */

  function hasDiscount(p) { return p.originalPrice !== null && p.originalPrice > p.price; }

  function getOfferLabel(p) {
    if (hasDiscount(p) && p.discountPercent >= 1) return p.discountPercent + (activeLanguage === 'bn' ? '% ছাড়' : '% OFF');
    // Never show a manual percentage-off claim when the prices do not validate it.
    if (/%|\bdiscount\b|\boff\b/i.test(p.offer || '')) return '';
    return p.offer || '';
  }

  function isFlashDealActive(p) { return p.isFlashDeal && !state.flashExpired; }

  function getStockLimit(p) { return Math.min(p.stock, CONFIG.maxQuantityPerLine); }

  function getStockLabel(p) {
    if (activeLanguage === 'bn') {
      if (p.stock <= 0) return 'স্টকে নেই';
      if (p.stock <= CONFIG.lowStockThreshold) return 'সীমিত স্টক — মাত্র ' + p.stock + 'টি বাকি';
      return 'স্টকে আছে';
    }
    if (p.stock <= 0) return 'Out of stock';
    if (p.stock <= CONFIG.lowStockThreshold) return 'Limited stock — only ' + p.stock + ' left';
    return 'In stock';
  }

  function createProductCard(p) {
    if (!dom.productTemplate) { console.error('[ShobPaben] #product-card-template is missing.'); return null; }
    const card = dom.productTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.productId = p.id;
    card.dataset.category = p.category;

    const badge = $('[data-field="offer"]', card);
    const label = getOfferLabel(p);
    if (badge) { badge.textContent = label; badge.hidden = !label; }

    const heart = $('.wishlist-button', card);
    if (heart) { heart.dataset.productId = p.id; syncWishlistButton(heart, p.id); }

    setImage($('[data-field="image"]', card), p.image, p.name);

    const nameEl = $('[data-field="name"]', card);
    if (nameEl) {
      // A link inside the heading lets the whole card be clickable (the CSS stretches it over the card).
      const link = document.createElement('a');
      link.href = '#/product/' + encodeURIComponent(p.id);
      link.dataset.action = 'open-product';
      link.dataset.productId = p.id;
      link.textContent = p.name;
      nameEl.textContent = '';
      nameEl.appendChild(link);
    }

    setText($('[data-field="price"]', card), formatMoney(p.price));
    const original = $('[data-field="originalPrice"]', card);
    if (original) {
      if (hasDiscount(p)) { original.textContent = formatMoney(p.originalPrice); original.hidden = false; }
      else { original.textContent = ''; original.hidden = true; }
    }
    setText($('[data-field="stock"]', card), getStockLabel(p));

    const details = $('.view-details-link', card);
    if (details) { details.dataset.productId = p.id; details.href = '#/product/' + encodeURIComponent(p.id); }

    const add = $('.add-to-cart-button', card);
    if (add) {
      add.dataset.productId = p.id;
      add.textContent = p.stock <= 0 ? (activeLanguage === 'bn' ? 'স্টকে নেই' : 'Out of Stock') : (activeLanguage === 'bn' ? 'কার্টে যোগ করুন' : 'Add to Cart');
      if (p.stock <= 0) add.disabled = true;
    }
    return card;
  }

  function renderProductGrid(container, products, options) {
    if (!container) return;
    const opts = options || {};
    const frag = document.createDocumentFragment();
    const seen = new Set();
    products.forEach(p => {
      if (seen.has(p.id)) return; // never show the same product twice in one grid
      seen.add(p.id);
      const card = createProductCard(p);
      if (card) frag.appendChild(card);
    });
    if (opts.append) container.appendChild(frag); else container.replaceChildren(frag);
  }

  /* ---- Selection helpers for homepage sections ---- */
  function byFeaturedThenOrder(a, b) {
    return (Number(b.isFeatured) - Number(a.isFeatured)) || (a.order - b.order);
  }

  function pickBalanced(products, limit) {
    const buckets = CATEGORIES.map(c => products.filter(p => p.category === c.id));
    const out = [];
    for (let i = 0; out.length < limit && buckets.some(b => i < b.length); i++) {
      buckets.forEach(b => { if (i < b.length && out.length < limit) out.push(b[i]); });
    }
    return out;
  }

  function sortNewest(a, b) {
    const ta = a.createdAt ? Date.parse(a.createdAt) : -Infinity;
    const tb = b.createdAt ? Date.parse(b.createdAt) : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.order - b.order;
  }

  function renderHome() {
    // Flash deals (static placeholder cards are replaced, never duplicated)
    const flash = pickBalanced(PUBLIC_PRODUCTS.filter(isFlashDealActive).sort(byFeaturedThenOrder), CONFIG.home.flashDeals);
    renderProductGrid(dom.flashGrid, flash);
    setHidden(dom.flashSection, flash.length === 0);

    // Five category sections
    CATEGORIES.forEach(cat => {
      const section = byId(cat.id + '-section');
      const grid = byId(cat.id + '-home-grid');
      const items = PUBLIC_PRODUCTS.filter(p => p.category === cat.id).sort(byFeaturedThenOrder).slice(0, CONFIG.home.perCategory);
      renderProductGrid(grid, items);
      setHidden(section, items.length === 0);
    });

    // New arrivals & best sellers: explicit flags only. Empty grids keep the HTML's empty-state message.
    renderProductGrid(dom.newArrivalsGrid, pickBalanced(PUBLIC_PRODUCTS.filter(p => p.isNewArrival).sort(sortNewest), CONFIG.home.newArrivals));
    renderProductGrid(dom.bestSellersGrid, pickBalanced(PUBLIC_PRODUCTS.filter(p => p.isBestSeller).sort(byFeaturedThenOrder), CONFIG.home.bestSellers));

    updateCategoryCounts();
  }

  function updateCategoryCounts() {
    CATEGORIES.forEach(cat => {
      const count = PUBLIC_PRODUCTS.filter(p => p.category === cat.id).length;
      $$('[data-category-count="' + cat.id + '"]').forEach(el => { el.textContent = String(count); });
    });
  }

  /* ---- Flash-deal countdown (only when a real end time is configured) ---- */
  let flashInterval = null;

  function initFlashTimer() {
    const timer = dom.flashTimer;
    if (!timer) return;
    const raw = (timer.dataset.endTime || CONFIG.flashDealEndTime || '').trim();
    const end = raw ? Date.parse(raw) : NaN;
    if (!Number.isFinite(end)) { timer.hidden = true; return; }

    const parts = {
      d: byId('timer-days'), h: byId('timer-hours'), m: byId('timer-minutes'), s: byId('timer-seconds')
    };
    const pad = n => String(n).padStart(2, '0');

    const tick = () => {
      const remaining = end - Date.now();
      if (remaining <= 0) {
        clearInterval(flashInterval);
        timer.hidden = true;
        if (!state.flashExpired) { state.flashExpired = true; renderHome(); }
        return;
      }
      const total = Math.floor(remaining / 1000);
      setText(parts.d, pad(Math.floor(total / 86400)));
      setText(parts.h, pad(Math.floor((total % 86400) / 3600)));
      setText(parts.m, pad(Math.floor((total % 3600) / 60)));
      setText(parts.s, pad(total % 60));
    };
    timer.hidden = false;
    tick();
    if (!state.flashExpired) flashInterval = setInterval(tick, 1000);
  }

  /* ======================================================================
     6. ROUTER / PAGE VIEWS / CATEGORY NAVIGATION
     Routes live in the URL hash, e.g. #/category/beauty, #/product/beauty-001
     ====================================================================== */

  const PAGE_ID_TO_ROUTE = Object.keys(PAGE_ROUTES).reduce((acc, key) => { acc[PAGE_ROUTES[key]] = key; return acc; }, {});

  const CATEGORY_BN = { electronics: 'ইলেকট্রনিক্স ও গ্যাজেটস', 'home-kitchen': 'ঘর ও রান্নাঘর', beauty: 'সৌন্দর্য ও ব্যক্তিগত পরিচর্যা', fashion: 'গেমস ও খেলনা', 'baby-kids': 'শিশু ও কিডস' };
  const COLLECTION_BN = { all: 'সব পণ্য', 'flash-deals': 'ফ্ল্যাশ ডিল', 'all-deals': 'সব অফার', 'new-arrivals': 'নতুন পণ্য', 'best-sellers': 'বেস্ট সেলার' };

  function getCollectionInfo(id) {
    const cat = CATEGORIES.find(c => c.id === id);
    if (cat) return { id, name: activeLanguage === 'bn' ? CATEGORY_BN[id] : cat.name, description: activeLanguage === 'bn' ? ({electronics:'স্মার্ট ডিভাইস, অ্যাক্সেসরিজ ও দৈনন্দিন গ্যাজেট।','home-kitchen':'রান্নার সামগ্রী, সংরক্ষণের পণ্য ও ঘরের প্রয়োজনীয় জিনিস।',beauty:'ত্বকের যত্ন, গ্রুমিং ও ব্যক্তিগত পরিচর্যার পণ্য।',fashion:'বোর্ড গেম, পাজল ও সব বয়সের জন্য সৃজনশীল খেলনা।','baby-kids':'শিশু ও বাচ্চাদের দৈনন্দিন প্রয়োজনীয় পণ্য।'}[id]) : cat.description, isCategory: true };
    if (COLLECTIONS[id]) return { id, name: activeLanguage === 'bn' ? COLLECTION_BN[id] : COLLECTIONS[id].name, description: activeLanguage === 'bn' ? ({all:'প্রকাশিত সব পণ্য এক তালিকায়।','flash-deals':'নির্বাচিত পণ্যে সীমিত সময়ের অফার।','all-deals':'অফার বা কম দামের পণ্য।','new-arrivals':'নতুন যুক্ত হওয়া পণ্য।','best-sellers':'বেস্ট সেলার হিসেবে চিহ্নিত পণ্য।'}[id]) : COLLECTIONS[id].description, isCategory: false };
    return null;
  }

  function parseHash() {
    const raw = window.location.hash || '';
    if (!raw.startsWith('#/')) return { name: 'home', pageId: 'home-page' };
    const path = raw.slice(2);
    if (path === '' || path === 'home') return { name: 'home', pageId: 'home-page' };
    if (path.startsWith('category/')) return { name: 'category', pageId: 'category-page', collection: safeDecode(path.slice(9)) };
    if (path.startsWith('search/')) return { name: 'search', pageId: 'category-page', query: safeDecode(path.slice(7)) };
    if (path.startsWith('product/')) return { name: 'product', pageId: 'product-details-page', productId: safeDecode(path.slice(8)) };
    if (path.startsWith('order/')) return { name: 'order', pageId: 'order-confirmation-page', orderId: safeDecode(path.slice(6)) };
    if (PAGE_ROUTES[path]) return { name: path, pageId: PAGE_ROUTES[path] };
    return { name: 'home', pageId: 'home-page' };
  }

  function hashFor(path) { return path ? '#/' + path : '#/'; }

  function categoryPath(id) { return 'category/' + encodeURIComponent(id); }
  function productPath(id) { return 'product/' + encodeURIComponent(id); }

  /** Change the page. Hash changes drive rendering, so back/forward buttons work. */
  function navigate(path) {
    const target = hashFor(path);
    const current = window.location.hash || '';
    const sameHome = path === '' && (current === '' || current === '#' || current === '#/');
    if (current === target || sameHome) { renderRoute(false); }
    else { window.location.hash = target; }
  }

  function replaceHash(path) {
    try { window.history.replaceState(null, '', hashFor(path)); }
    catch (e) { window.location.hash = hashFor(path); }
  }

  function showView(pageId) {
    dom.views.forEach(view => {
      const active = view.id === pageId;
      view.hidden = !active;
      view.classList.toggle('is-active', active);
    });
  }

  function guardRoute(route) {
    if ((route.name === 'category') && !getCollectionInfo(route.collection)) {
      toast.show('That category was not found.', { type: 'error' });
      replaceHash('');
      return { name: 'home', pageId: 'home-page' };
    }
    if (route.name === 'search' && !route.query.trim()) {
      replaceHash('');
      return { name: 'home', pageId: 'home-page' };
    }
    if (route.name === 'product' && !PUBLIC_BY_ID.has(route.productId)) {
      toast.show('This product is not available.', { type: 'error' });
      replaceHash('');
      return { name: 'home', pageId: 'home-page' };
    }
    if (route.name === 'checkout' && state.cart.lines.length === 0) {
      toast.show('Your cart is empty. Add a product before checking out.', { type: 'error' });
      replaceHash('cart');
      return { name: 'cart', pageId: 'cart-page' };
    }
    if (route.name === 'order-confirmation') {
      const order = findOrder(state.lastOrderId) || state.pendingOrder || state.orders[0];
      if (!order) { replaceHash(''); return { name: 'home', pageId: 'home-page' }; }
    }
    if (route.name === 'order' && !findOrder(route.orderId)) {
      replaceHash('orders');
      return { name: 'orders', pageId: 'order-history-page' };
    }
    return route;
  }

  function getPageTitle(route) {
    const base = 'ShobPaben.online';
    const isBn = activeLanguage === 'bn';
    const bnNames = {
      electronics: 'ইলেকট্রনিক্স ও গ্যাজেট',
      'home-kitchen': 'হোম ও কিচেন',
      beauty: 'বিউটি ও পার্সোনাল কেয়ার',
      fashion: 'গেমস ও খেলনা',
      'baby-kids': 'বেবি ও কিডস',
      all: 'সব পণ্য',
      'flash-deals': 'ফ্ল্যাশ ডিল',
      'all-deals': 'সব অফার',
      'new-arrivals': 'নতুন পণ্য',
      'best-sellers': 'বেস্ট সেলার'
    };
    switch (route.name) {
      case 'home':
        return isBn ? 'বাংলাদেশে অনলাইন কেনাকাটা | ' + base : 'Online Shopping in Bangladesh | ' + base;
      case 'category': {
        const info = getCollectionInfo(route.collection);
        const title = isBn ? (bnNames[route.collection] || (info ? info.name : 'ক্যাটাগরি')) : (info ? info.name : 'Category');
        return isBn ? title + ' | ' + base : title + ' Online in Bangladesh | ' + base;
      }
      case 'search':
        return (isBn ? 'অনুসন্ধান: ' : 'Search: ') + route.query + ' | ' + base;
      case 'product': {
        const p = PUBLIC_BY_ID.get(route.productId);
        return p ? (isBn ? p.name + ' | ' + base : p.name + ' Price in Bangladesh | ' + base) : (isBn ? 'পণ্য | ' : 'Product | ') + base;
      }
      case 'cart': return (isBn ? 'কার্ট | ' : 'Shopping Cart | ') + base;
      case 'checkout': return (isBn ? 'চেকআউট | ' : 'Checkout | ') + base;
      case 'order-confirmation': case 'order': return (isBn ? 'অর্ডারের তথ্য | ' : 'Order Details | ') + base;
      case 'wishlist': return (isBn ? 'ইচ্ছেতালিকা | ' : 'Wishlist | ') + base;
      case 'account': return (isBn ? 'অ্যাকাউন্ট | ' : 'Account | ') + base;
      case 'orders': return (isBn ? 'অর্ডারের ইতিহাস | ' : 'Order History | ') + base;
      case 'about': return (isBn ? 'আমাদের সম্পর্কে | ' : 'About | ') + base;
      case 'contact': return (isBn ? 'যোগাযোগ | ' : 'Contact | ') + base;
      default: return base;
    }
  }

  function getPageDescription(route) {
    const isBn = activeLanguage === 'bn';
    if (route.name === 'home') {
      return isBn
        ? 'ShobPaben.online-এ বাংলাদেশে অনলাইনে ইলেকট্রনিক্স, হোম ও কিচেন, বিউটি, গেমস ও খেলনা এবং দৈনন্দিন প্রয়োজনীয় পণ্য কিনুন।'
        : 'Shop electronics, home and kitchen essentials, beauty and personal care, Games & Toys, and baby and kids products online in Bangladesh with ShobPaben.online.';
    }
    if (route.name === 'product') {
      const p = PUBLIC_BY_ID.get(route.productId);
      if (!p) return isBn ? 'ShobPaben.online-এ অনলাইনে কেনাকাটা করুন।' : 'Shop online at ShobPaben.online.';
      const name = p.name;
      const detail = p.description || '';
      return isBn
        ? name + ' — ShobPaben.online-এ পণ্যের বিবরণ ও দাম দেখুন।'
        : (detail ? detail + ' ' : '') + 'Shop ' + name + ' online in Bangladesh at ShobPaben.online.';
    }
    if (route.name === 'category') {
      const info = getCollectionInfo(route.collection);
      const descriptions = {
        electronics: 'Shop electronics and gadgets online in Bangladesh.',
        'home-kitchen': 'Browse home and kitchen essentials online in Bangladesh.',
        beauty: 'Shop beauty and personal care products online in Bangladesh.',
        fashion: 'Browse Games & Toys online in Bangladesh.',
        'baby-kids': 'Shop baby and kids products online in Bangladesh.',
        all: 'Browse all products at ShobPaben.online.',
        'flash-deals': 'Discover current featured deals at ShobPaben.online.',
        'all-deals': 'Browse products with offers and reduced prices at ShobPaben.online.',
        'new-arrivals': 'Explore newly added products at ShobPaben.online.',
        'best-sellers': 'Explore products marked as best sellers at ShobPaben.online.'
      };
      const bnDescriptions = {
        electronics: 'বাংলাদেশে অনলাইনে ইলেকট্রনিক্স ও গ্যাজেট কিনুন।',
        'home-kitchen': 'অনলাইনে হোম ও কিচেনের প্রয়োজনীয় পণ্য দেখুন।',
        beauty: 'বিউটি ও পার্সোনাল কেয়ার পণ্য অনলাইনে কিনুন।',
        fashion: 'গেমস ও খেলনা দেখুন।',
        'baby-kids': 'বেবি ও কিডসের পণ্য অনলাইনে কিনুন।',
        all: 'ShobPaben.online-এ সব পণ্য দেখুন।',
        'flash-deals': 'ShobPaben.online-এর নির্বাচিত ডিল দেখুন।',
        'all-deals': 'অফার ও কম দামের পণ্যগুলো দেখুন।',
        'new-arrivals': 'ShobPaben.online-এ নতুন যুক্ত হওয়া পণ্য দেখুন।',
        'best-sellers': 'বেস্ট সেলার হিসেবে চিহ্নিত পণ্যগুলো দেখুন।'
      };
      return (isBn ? bnDescriptions[route.collection] : descriptions[route.collection]) ||
        (info ? info.description : (isBn ? 'ShobPaben.online-এ অনলাইনে কেনাকাটা করুন।' : 'Shop online at ShobPaben.online.'));
    }
    if (route.name === 'search') {
      return isBn ? 'আপনার অনুসন্ধানের ফলাফল দেখুন ShobPaben.online-এ।' : 'Browse product search results at ShobPaben.online.';
    }
    const utilityPages = ['cart', 'checkout', 'wishlist', 'account', 'orders', 'order-confirmation', 'order'];
    if (utilityPages.includes(route.name)) {
      return isBn ? 'ShobPaben.online গ্রাহক পৃষ্ঠা।' : 'Customer page at ShobPaben.online.';
    }
    return isBn
      ? 'ShobPaben.online সম্পর্কে জানুন বা আমাদের সঙ্গে যোগাযোগ করুন।'
      : 'Learn more about ShobPaben.online or contact our customer support team.';
  }

  function updateSeoMetadata(route) {
    const setMeta = (selector, value) => {
      const element = document.querySelector(selector);
      if (element) element.setAttribute('content', value);
    };
    const title = getPageTitle(route);
    const rawDescription = getPageDescription(route).replace(/\s+/g, ' ').trim();
    const description = rawDescription.length > 160 ? rawDescription.slice(0, 157).trimEnd() + '…' : rawDescription;
    document.title = title;
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
    setMeta('meta[property="og:locale"]', activeLanguage === 'bn' ? 'bn_BD' : 'en_BD');

    // This storefront currently uses hash-based client-side routes. Keep one
    // canonical document URL rather than publishing fragment URLs as separate pages.
    setMeta('meta[property="og:url"]', 'https://shobpaben.online/');
    setMeta('meta[name="twitter:url"]', 'https://shobpaben.online/');

    const utilityOrSearch = ['search', 'cart', 'checkout', 'wishlist', 'account', 'orders', 'order-confirmation', 'order'].includes(route.name);
    setMeta('meta[name="robots"]', utilityOrSearch ? 'noindex, follow' : 'index, follow, max-image-preview:large');
    setMeta('meta[name="googlebot"]', utilityOrSearch ? 'noindex, follow' : 'index, follow, max-image-preview:large');
  }

  let firstRender = true;

  function renderRoute(fromHashChange) {
    const route = guardRoute(parseHash());
    state.route = route;
    const wasFirst = firstRender;
    firstRender = false;

    closeMenu(false);
    closeQuickView();
    hideSuggestions();

    switch (route.name) {
      case 'home':
        showView('home-page');
        break;
      case 'category':
      case 'search':
        showView('category-page');
        renderListingPage(route);
        break;
      case 'product':
        showView('product-details-page');
        renderProductPage(PUBLIC_BY_ID.get(route.productId));
        break;
      case 'checkout':
        showView('checkout-page');
        state.isPlacingOrder = false;
        if (dom.placeOrder) dom.placeOrder.disabled = false;
        renderCheckoutSummary();
        break;
      case 'wishlist':
        showView('wishlist-page');
        renderWishlistPage();
        break;
      case 'orders':
        showView('order-history-page');
        renderOrderHistory();
        break;
      case 'order-confirmation':
        showView('order-confirmation-page');
        renderConfirmation(findOrder(state.lastOrderId) || state.pendingOrder || state.orders[0]);
        break;
      case 'order':
        showView('order-confirmation-page');
        renderConfirmation(findOrder(route.orderId));
        break;
      default:
        showView(route.pageId);
    }

    if (route.name === 'home' || route.name === 'category' || route.name === 'search') {
      state.lastBrowsePath = route.name === 'home' ? '' : (route.name === 'search' ? 'search/' + encodeURIComponent(route.query) : categoryPath(route.collection));
    }
    if (route.name !== 'search' && dom.searchInput && state.listing.lastSearchText &&
        dom.searchInput.value.trim() === state.listing.lastSearchText) {
      dom.searchInput.value = '';
    }

    updateNavState(route);
    applyStaticLanguage();
    updateSeoMetadata(route);
    carousel.syncVisibility();

    // Scrolling / focus (skipped for the very first render so the browser keeps its own behaviour)
    if (state.pendingScrollId) {
      const target = byId(state.pendingScrollId);
      state.pendingScrollId = '';
      if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    }
    if (!wasFirst || fromHashChange) {
      scrollToTop();
      if (dom.main && !wasFirst) { try { dom.main.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
  }

  function linkMatchesRoute(link, route) {
    const action = link.dataset.action;
    if (action === 'open-category') return route.name === 'category' && link.dataset.category === route.collection;
    if (action === 'open-cart') return route.pageId === 'cart-page';
    if (action === 'open-page') return !!link.dataset.page && link.dataset.page === route.pageId;
    return false;
  }

  function updateNavState(route) {
    $$('.menu-list a, .header-link').forEach(link => {
      if (linkMatchesRoute(link, route)) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function continueShopping(el) {
    const goesHome = el.closest('.site-logo') || el.classList.contains('back-link');
    navigate(goesHome ? '' : state.lastBrowsePath);
  }

  function openCategory(id) {
    const category = id && id.trim() ? id.trim() : 'all';
    if (!getCollectionInfo(category)) { toast.show('That category is not available.', { type: 'error' }); return; }
    navigate(categoryPath(category));
  }

  function openPageFromLink(link) {
    const page = link.dataset.page;
    if (page === 'home-page') {
      const href = link.getAttribute('href') || '';
      if (href.length > 1 && href.charAt(0) === '#' && href.charAt(1) !== '/' && byId(href.slice(1))) {
        state.pendingScrollId = href.slice(1);
      }
      navigate('');
    } else if (page === 'category-page') {
      navigate(categoryPath('all'));
    } else if (PAGE_ID_TO_ROUTE[page]) {
      navigate(PAGE_ID_TO_ROUTE[page]);
    } else {
      toast.show('This page is not available yet. Please contact us on WhatsApp for help.');
    }
  }

  /* ======================================================================
     7. HEADER MENU
     ====================================================================== */

  function openMenu() {
    if (!dom.menu || !dom.hamburger) return;
    dom.menu.hidden = false;
    dom.hamburger.setAttribute('aria-expanded', 'true');
    dom.hamburger.setAttribute('aria-label', 'Close main menu');
    if (dom.menuClose) dom.menuClose.focus();
  }

  function closeMenu(restoreFocus) {
    if (!dom.menu || dom.menu.hidden) return;
    dom.menu.hidden = true;
    if (dom.hamburger) {
      dom.hamburger.setAttribute('aria-expanded', 'false');
      dom.hamburger.setAttribute('aria-label', 'Open main menu');
      if (restoreFocus) dom.hamburger.focus();
    }
  }

  function trapMenuFocus(e) {
    if (e.key !== 'Tab' || !dom.menu || dom.menu.hidden) return;
    const focusable = $$('a[href], button:not([disabled])', dom.menu).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ======================================================================
     8. SEARCH & AUTOCOMPLETE (published products only)
     ====================================================================== */

  const searchUi = { options: [], active: -1, lastQuery: '' };

  function scoreProduct(p, phrase, tokens) {
    const idx = p.searchIndex;
    let score = 0;
    for (const token of tokens) {
      let tokenScore = 0;
      if (idx.name.includes(token)) tokenScore += 10;
      if (idx.brand.includes(token)) tokenScore += 6;
      if (idx.category.includes(token)) tokenScore += 4;
      if (idx.description.includes(token)) tokenScore += 2;
      if (tokenScore === 0) return 0; // every word must match somewhere
      score += tokenScore;
    }
    if (idx.name.includes(phrase)) score += 50;
    if (idx.name.startsWith(phrase)) score += 30;
    return score;
  }

  function searchProducts(query) {
    const phrase = normalizeText(query);
    const tokens = phrase.split(' ').filter(Boolean);
    if (!tokens.length) return [];
    return PUBLIC_PRODUCTS
      .map(p => ({ p, score: scoreProduct(p, phrase, tokens) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.p.order - b.p.order))
      .map(entry => entry.p);
  }

  function hideSuggestions() {
    if (!dom.suggestions) return;
    dom.suggestions.hidden = true;
    dom.suggestions.replaceChildren();
    searchUi.options = [];
    searchUi.active = -1;
    if (dom.searchInput) {
      dom.searchInput.setAttribute('aria-expanded', 'false');
      dom.searchInput.removeAttribute('aria-activedescendant');
    }
  }

  function renderSuggestions(query) {
    const box = dom.suggestions;
    if (!box || !dom.searchInput) return;
    const q = query.trim();
    if (!q) { hideSuggestions(); return; }

    const results = searchProducts(q);
    const frag = document.createDocumentFragment();
    searchUi.options = [];

    const makeOption = (text, extra, data) => {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', 'false');
      opt.id = 'search-option-' + searchUi.options.length;
      const label = document.createElement('span');
      label.textContent = text;
      opt.appendChild(label);
      if (extra) {
        const small = document.createElement('span');
        small.textContent = ' · ' + extra;
        small.style.color = 'var(--text-muted)';
        small.style.fontSize = '0.8125rem';
        opt.appendChild(small);
      }
      Object.keys(data).forEach(k => { opt.dataset[k] = data[k]; });
      frag.appendChild(opt);
      return opt;
    };

    if (!results.length) {
      const empty = makeOption('No products found for “' + q + '”', '', { kind: 'none' });
      empty.setAttribute('aria-disabled', 'true');
    } else {
      results.slice(0, CONFIG.suggestionLimit).forEach(p => {
        const cat = CATEGORIES.find(c => c.id === p.category);
        searchUi.options.push(makeOption(p.name, cat ? (activeLanguage === 'bn' ? CATEGORY_BN[cat.id] : cat.name) : '', { kind: 'product', productId: p.id }));
      });
      searchUi.options.push(makeOption('See all ' + results.length + ' result' + (results.length === 1 ? '' : 's') + ' for “' + q + '”', '', { kind: 'all' }));
    }

    box.replaceChildren(frag);
    box.hidden = false;
    searchUi.active = -1;
    dom.searchInput.setAttribute('aria-expanded', 'true');
    dom.searchInput.removeAttribute('aria-activedescendant');
  }

  function setActiveSuggestion(index) {
    if (!searchUi.options.length) return;
    const count = searchUi.options.length;
    const next = (index + count) % count;
    searchUi.options.forEach((opt, i) => opt.setAttribute('aria-selected', i === next ? 'true' : 'false'));
    searchUi.active = next;
    const current = searchUi.options[next];
    dom.searchInput.setAttribute('aria-activedescendant', current.id);
    if (current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  function activateSuggestion(option) {
    if (!option || option.dataset.kind === 'none') return;
    if (option.dataset.kind === 'product') {
      hideSuggestions();
      navigate(productPath(option.dataset.productId));
    } else if (option.dataset.kind === 'all') {
      runSearch(dom.searchInput.value);
    }
  }

  function runSearch(rawQuery) {
    const q = String(rawQuery || '').replace(/\s+/g, ' ').trim();
    hideSuggestions();
    if (!q) { if (dom.searchInput) dom.searchInput.focus(); return; }
    state.listing.lastSearchText = q;
    if (dom.searchInput) { dom.searchInput.value = q; dom.searchInput.blur(); }
    navigate('search/' + encodeURIComponent(q));
  }

  function setupSearch() {
    const input = dom.searchInput;
    if (!input) return;
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    if (dom.suggestions) {
      input.setAttribute('aria-controls', dom.suggestions.id);
      // Keep focus in the input while clicking a suggestion.
      dom.suggestions.addEventListener('mousedown', e => e.preventDefault());
      dom.suggestions.addEventListener('click', e => {
        const option = e.target.closest('[role="option"]');
        if (option) activateSuggestion(option);
      });
    }

    const debounced = debounce(() => renderSuggestions(input.value), CONFIG.searchDebounceMs);
    input.addEventListener('input', debounced);
    input.addEventListener('focus', () => { if (input.value.trim()) renderSuggestions(input.value); });

    input.addEventListener('keydown', e => {
      const open = dom.suggestions && !dom.suggestions.hidden;
      if (e.key === 'ArrowDown') {
        if (!open && input.value.trim()) renderSuggestions(input.value);
        if (searchUi.options.length) { e.preventDefault(); setActiveSuggestion(searchUi.active + 1); }
      } else if (e.key === 'ArrowUp') {
        if (searchUi.options.length) { e.preventDefault(); setActiveSuggestion(searchUi.active < 0 ? -1 : searchUi.active - 1); }
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); hideSuggestions(); }
      } else if (e.key === 'Enter') {
        if (open && searchUi.active >= 0) { e.preventDefault(); activateSuggestion(searchUi.options[searchUi.active]); }
      }
    });

    // Native "clear" (×) button / Escape in a search field: leave the results page.
    input.addEventListener('search', () => {
      if (!input.value) {
        hideSuggestions();
        if (state.route.name === 'search') navigate('');
      }
    });

    if (dom.searchForm) {
      dom.searchForm.addEventListener('focusout', e => {
        if (!dom.searchForm.contains(e.relatedTarget)) hideSuggestions();
      });
    }
  }

  function clearSearch() {
    hideSuggestions();
    if (dom.searchInput) dom.searchInput.value = '';
    state.listing.lastSearchText = '';
    navigate('');
  }

  /* ======================================================================
     9. HERO CAROUSEL
     Slides are laid out in a flex track (see CSS). Direction is always
     right-to-left: the flex "order" of the slides is rotated so the loop
     never rewinds backwards.
     ====================================================================== */

  const carousel = (function () {
    let root, track, slides, dots;
    let count = 0;
    let current = 0;
    let target = 0;
    let animating = false;
    let autoplayTimer = null;
    let fallbackTimer = null;
    let ready = false;
    let initialized = false;
    const pause = { hover: false, focus: false, contact: false, reduced: false, hidden: false };

    function reflow() { void track.offsetWidth; }
    function setTransition(enabled) { track.style.transition = enabled ? '' : 'none'; }
    function setOffset(percent) { track.style.transform = 'translateX(' + percent + '%)'; }

    /** Put `first` at the start of the flex line, `second` right after it, the rest following. */
    function applyOrder(first, second) {
      const sequence = [first, second];
      for (let k = 1; k <= count; k++) {
        const idx = (second + k) % count;
        if (idx !== first && idx !== second) sequence.push(idx);
      }
      sequence.forEach((idx, position) => { slides[idx].style.order = String(position); });
    }

    function updateUi(active) {
      slides.forEach((slide, i) => {
        if ('inert' in slide) slide.inert = i !== active;
      });
      dots.forEach((dot, i) => {
        const isActive = i === active;
        dot.classList.toggle('is-active', isActive);
        if (isActive) dot.setAttribute('aria-current', 'true'); else dot.removeAttribute('aria-current');
      });
    }

    function shouldPlay() {
      return ready && !animating && !document.hidden && !pause.reduced && !pause.hover && !pause.focus && !pause.contact && !pause.hidden && count > 1;
    }

    function cancelSchedule() {
      if (autoplayTimer !== null) clearTimeout(autoplayTimer);
      autoplayTimer = null;
    }

    function schedule() {
      cancelSchedule();
      if (!shouldPlay()) return;
      const delay = Number.isFinite(CONFIG.autoplayMs) && CONFIG.autoplayMs > 0 ? CONFIG.autoplayMs : 5000;
      autoplayTimer = setTimeout(() => {
        autoplayTimer = null;
        if (shouldPlay()) next();
      }, delay);
    }

    function settle() {
      if (!animating) return;
      clearTimeout(fallbackTimer);
      animating = false;
      current = target;
      applyOrder(current, (current + 1) % count);
      setTransition(false);
      setOffset(0);
      reflow();
      setTransition(true);
      schedule();
    }

    function goTo(index, direction) {
      if (!ready) return;
      const wanted = ((index % count) + count) % count;
      if (animating) settle();
      if (wanted === current) return;
      cancelSchedule();
      const dir = direction || (wanted > current ? 'next' : 'prev');
      target = wanted;
      animating = true;

      if (prefersReducedMotion && prefersReducedMotion.matches) {
        settle();
        updateUi(current);
        return;
      }

      if (dir === 'next') {
        applyOrder(current, target);
        setTransition(false); setOffset(0); reflow(); setTransition(true);
        setOffset(-100);
      } else {
        applyOrder(target, current);
        setTransition(false); setOffset(-100); reflow(); setTransition(true);
        setOffset(0);
      }
      updateUi(target);
      fallbackTimer = setTimeout(settle, 800);
    }

    function next() { goTo(current + 1, 'next'); }
    function prev() { goTo(current - 1, 'prev'); }

    function syncVisibility() {
      if (!ready) return;
      const homeView = byId('home-page');
      pause.hidden = document.hidden || state.route.name !== 'home' || (homeView ? homeView.hidden : false);
      schedule();
    }

    function init() {
      if (initialized) return;
      root = dom.heroSection;
      track = byId('hero-track');
      if (!root || !track) return;
      slides = $$('.hero-slide', track);
      dots = $$('.hero-dot', root);
      count = slides.length;
      if (count === 0) return;
      initialized = true;
      if (count !== 5) console.warn('[ShobPaben] The carousel expects 5 slides but found ' + count + '.');
      if (dots.length !== count) console.warn('[ShobPaben] The carousel has ' + count + ' slides but ' + dots.length + ' dots.');

      slides.forEach(slide => {
        slide.setAttribute('role', 'group');
        slide.setAttribute('aria-roledescription', 'slide');
      });
      root.setAttribute('aria-roledescription', 'carousel');

      ready = true;
      pause.hover = !!(root.matches && root.matches(':hover'));
      pause.focus = !!(root.contains(document.activeElement) && document.activeElement.matches && document.activeElement.matches(':focus-visible'));
      pause.reduced = !!(prefersReducedMotion && prefersReducedMotion.matches);
      applyOrder(0, count > 1 ? 1 : 0);
      setOffset(0);
      updateUi(0);

      track.addEventListener('transitionend', e => {
        if (e.target === track && e.propertyName === 'transform') settle();
      });

      root.addEventListener('mouseenter', () => { pause.hover = true; cancelSchedule(); });
      root.addEventListener('mouseleave', () => { pause.hover = false; schedule(); });
      root.addEventListener('focusin', e => {
        if (e.target.matches && e.target.matches(':focus-visible')) {
          pause.focus = true; cancelSchedule();
        }
      });
      root.addEventListener('focusout', e => {
        if (!root.contains(e.relatedTarget)) { pause.focus = false; schedule(); }
      });
      root.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') { prev(); }
        else if (e.key === 'ArrowRight') { next(); }
      });

      // Touch swipe
      let startX = 0, startY = 0, tracking = false;
      const viewport = byId('hero-viewport') || root;
      viewport.addEventListener('touchstart', e => {
        pause.contact = true; cancelSchedule();
        if (e.touches.length !== 1) { tracking = false; return; }
        tracking = true; startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      }, { passive: true });
      viewport.addEventListener('touchend', e => {
        if (tracking && e.changedTouches.length) {
          const t = e.changedTouches[0];
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { if (dx < 0) next(); else prev(); }
        }
        tracking = false; pause.contact = false; schedule();
      }, { passive: true });
      viewport.addEventListener('touchcancel', () => { tracking = false; pause.contact = false; schedule(); }, { passive: true });
      viewport.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch') { pause.contact = true; cancelSchedule(); } });
      const releasePointer = e => { if (e.pointerType !== 'touch') { pause.contact = false; schedule(); } };
      viewport.addEventListener('pointerup', releasePointer);
      viewport.addEventListener('pointercancel', releasePointer);
      viewport.addEventListener('lostpointercapture', releasePointer);

      document.addEventListener('visibilitychange', syncVisibility);
      window.addEventListener('pageshow', syncVisibility);
      window.addEventListener('focus', syncVisibility);
      window.addEventListener('resize', debounce(() => { if (animating) settle(); }, 150));

      if (prefersReducedMotion) {
        pause.reduced = prefersReducedMotion.matches;
        const onChange = e => { pause.reduced = e.matches; schedule(); };
        if (prefersReducedMotion.addEventListener) prefersReducedMotion.addEventListener('change', onChange);
        else if (prefersReducedMotion.addListener) prefersReducedMotion.addListener(onChange);
      }
      syncVisibility();
    }

    return {
      init, next, prev, syncVisibility,
      goTo: index => goTo(index)
    };
  })();

  /* ======================================================================
     10. CATEGORY LISTING: FILTERS, SORTING, LOAD MORE
     ====================================================================== */

  function collectionProducts(id) {
    switch (id) {
      case 'all': return PUBLIC_PRODUCTS.slice();
      case 'flash-deals': return PUBLIC_PRODUCTS.filter(isFlashDealActive);
      case 'all-deals': return PUBLIC_PRODUCTS.filter(p => isFlashDealActive(p) || hasDiscount(p));
      case 'new-arrivals': return PUBLIC_PRODUCTS.filter(p => p.isNewArrival);
      case 'best-sellers': return PUBLIC_PRODUCTS.filter(p => p.isBestSeller);
      default: return PUBLIC_PRODUCTS.filter(p => p.category === id);
    }
  }

  function getListingContext(route) {
    if (route.name === 'search') {
      const q = route.query.replace(/\s+/g, ' ').trim();
      return {
        key: 'search:' + normalizeText(q), isSearch: true, query: q, collection: '',
        title: activeLanguage === 'bn' ? 'অনুসন্ধানের ফলাফল' : 'Search results', breadcrumb: activeLanguage === 'bn' ? 'অনুসন্ধানের ফলাফল' : 'Search results', base: searchProducts(q)
      };
    }
    const info = getCollectionInfo(route.collection);
    return {
      key: 'collection:' + route.collection, isSearch: false, query: '', collection: route.collection,
      title: info.name, breadcrumb: info.name, description: info.description, base: collectionProducts(route.collection)
    };
  }

  const PRICE_FILTER = Object.freeze({ min: 0, max: 70000, step: 500 });
  let priceControlsInitialized = false;

  function syncPriceControls(source) {
    source = source || 'init';
    const minRange = dom.filterMinRange, maxRange = dom.filterMaxRange;
    const minInput = dom.filterMin, maxInput = dom.filterMax;
    const rangeRoot = byId('category-price-range');
    const ranges = [minRange, maxRange].filter(Boolean);

    // Apply the configured bounds every time. This also repairs stale HTML defaults
    // (for example max="0" and a disabled input) without relying on the markup.
    ranges.forEach(el => {
      el.min = String(PRICE_FILTER.min);
      el.max = String(PRICE_FILTER.max);
      el.step = String(PRICE_FILTER.step);
      el.disabled = false;
      el.removeAttribute('disabled');
    });

    const readValue = el => {
      if (!el || String(el.value).trim() === '') return null;
      const value = Number(el.value);
      return Number.isFinite(value) ? value : null;
    };
    const normalize = value => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return PRICE_FILTER.min;
      const bounded = clamp(numeric, PRICE_FILTER.min, PRICE_FILTER.max);
      return clamp(Math.round(bounded / PRICE_FILTER.step) * PRICE_FILTER.step, PRICE_FILTER.min, PRICE_FILTER.max);
    };

    let minValue, maxValue;
    if (!priceControlsInitialized && source === 'init') {
      // First initialization always opens with the complete intended price interval.
      // Do not trust old/incorrect HTML value attributes or stale hidden-field values.
      minValue = PRICE_FILTER.min;
      maxValue = PRICE_FILTER.max;
    } else {
      // Prefer the visible slider controls as the source of truth, with hidden fields
      // retained only as compatibility fallbacks for the existing filter pipeline.
      minValue = readValue(minRange);
      maxValue = readValue(maxRange);
      if (minValue === null) minValue = readValue(minInput);
      if (maxValue === null) maxValue = readValue(maxInput);
      if (minValue === null) minValue = PRICE_FILTER.min;
      if (maxValue === null) maxValue = PRICE_FILTER.max;
    }

    if (source === 'min-range' && minRange) minValue = readValue(minRange);
    if (source === 'max-range' && maxRange) maxValue = readValue(maxRange);
    if (source === 'min-input' && minInput) minValue = readValue(minInput);
    if (source === 'max-input' && maxInput) maxValue = readValue(maxInput);

    minValue = normalize(minValue === null ? PRICE_FILTER.min : minValue);
    maxValue = normalize(maxValue === null ? PRICE_FILTER.max : maxValue);

    // Do not let the handles cross; clamp only the handle that is being moved.
    if (minValue > maxValue) {
      if (source === 'min-range' || source === 'min-input') minValue = maxValue;
      else maxValue = minValue;
    }

    if (minRange) minRange.value = String(minValue);
    if (maxRange) maxRange.value = String(maxValue);
    if (minInput) minInput.value = String(minValue);
    if (maxInput) maxInput.value = String(maxValue);

    // Update the coloured segment of the shared track.
    if (rangeRoot) {
      const span = PRICE_FILTER.max - PRICE_FILTER.min || 1;
      const minPercent = ((minValue - PRICE_FILTER.min) / span) * 100;
      const maxPercent = ((maxValue - PRICE_FILTER.min) / span) * 100;
      rangeRoot.style.setProperty('--price-range-start', minPercent + '%');
      rangeRoot.style.setProperty('--price-range-end', maxPercent + '%');
    }

    const minLabel = activeLanguage === 'bn' ? 'সর্বনিম্ন মূল্য' : 'Minimum price';
    const maxLabel = activeLanguage === 'bn' ? 'সর্বোচ্চ মূল্য' : 'Maximum price';
    if (minRange) {
      minRange.setAttribute('aria-valuemin', String(PRICE_FILTER.min));
      minRange.setAttribute('aria-valuemax', String(maxValue));
      minRange.setAttribute('aria-valuetext', formatMoney(minValue));
      minRange.setAttribute('aria-label', minLabel);
    }
    if (maxRange) {
      maxRange.setAttribute('aria-valuemin', String(minValue));
      maxRange.setAttribute('aria-valuemax', String(PRICE_FILTER.max));
      maxRange.setAttribute('aria-valuetext', formatMoney(maxValue));
      maxRange.setAttribute('aria-label', maxLabel);
    }

    const minOutput = byId('category-min-price-value') || $('[data-price-range-min]');
    const maxOutput = byId('category-max-price-value') || $('[data-price-range-max]');
    setText(minOutput, formatMoney(minValue));
    setText(maxOutput, formatMoney(maxValue));
    const status = byId('category-price-range-status');
    if (status) status.textContent = activeLanguage === 'bn'
      ? formatMoney(minValue) + ' থেকে ' + formatMoney(maxValue)
      : formatMoney(minValue) + ' – ' + formatMoney(maxValue);

    priceControlsInitialized = true;
  }

  function setupPriceSliderPointerDragging() {
    const root = byId('category-price-range');
    const minRange = dom.filterMinRange;
    const maxRange = dom.filterMaxRange;
    if (!root || !minRange || !maxRange || root.dataset.pointerDragBound === 'true') return;

    root.dataset.pointerDragBound = 'true';
    root.style.touchAction = 'pan-y';
    let activePointerId = null;
    let activeSource = '';

    const getControlValues = () => {
      const min = Number(minRange.value);
      const max = Number(maxRange.value);
      return {
        min: Number.isFinite(min) ? min : PRICE_FILTER.min,
        max: Number.isFinite(max) ? max : PRICE_FILTER.max
      };
    };

    function valueFromPointer(clientX) {
      const rect = minRange.getBoundingClientRect();
      const thumbSize = 24;
      const usableWidth = Math.max(1, rect.width - thumbSize);
      const ratio = clamp((clientX - rect.left - thumbSize / 2) / usableWidth, 0, 1);
      const raw = PRICE_FILTER.min + ratio * (PRICE_FILTER.max - PRICE_FILTER.min);
      return clamp(
        Math.round(raw / PRICE_FILTER.step) * PRICE_FILTER.step,
        PRICE_FILTER.min,
        PRICE_FILTER.max
      );
    }

    function updateFromPointer(event) {
      if (!activeSource) return;
      const nextValue = valueFromPointer(event.clientX);
      const current = getControlValues();

      if (activeSource === 'min-range') {
        minRange.value = String(Math.min(nextValue, current.max));
      } else {
        maxRange.value = String(Math.max(nextValue, current.min));
      }

      syncPriceControls(activeSource);
      refreshListingDebounced();
    }

    function onPointerDown(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const rect = minRange.getBoundingClientRect();
      // Respond only in the horizontal track/handle row, not the legend or labels.
      if (event.clientY < rect.top - 4 || event.clientY > rect.bottom + 4 || rect.width < 24) return;

      const current = getControlValues();
      const inset = 12;
      const usableWidth = Math.max(1, rect.width - inset * 2);
      const minX = rect.left + inset + ((current.min - PRICE_FILTER.min) / (PRICE_FILTER.max - PRICE_FILTER.min)) * usableWidth;
      const maxX = rect.left + inset + ((current.max - PRICE_FILTER.min) / (PRICE_FILTER.max - PRICE_FILTER.min)) * usableWidth;
      const distanceToMin = Math.abs(event.clientX - minX);
      const distanceToMax = Math.abs(event.clientX - maxX);

      // Select the nearest handle, while honoring a directly targeted thumb where clear.
      if (event.target === minRange && distanceToMin <= 18) activeSource = 'min-range';
      else if (event.target === maxRange && distanceToMax <= 18) activeSource = 'max-range';
      else activeSource = distanceToMin <= distanceToMax ? 'min-range' : 'max-range';

      event.preventDefault();
      activePointerId = event.pointerId;
      root.classList.add('is-dragging');
      try {
        if (root.setPointerCapture) root.setPointerCapture(event.pointerId);
      } catch (error) {
        // Drag continues via events on the root when pointer capture is unavailable.
      }
      updateFromPointer(event);
    }

    function onPointerMove(event) {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      event.preventDefault();
      updateFromPointer(event);
    }

    function onPointerUp(event) {
      if (activePointerId === null || event.pointerId !== activePointerId) return;
      const pointerId = activePointerId;
      activePointerId = null;
      activeSource = '';
      root.classList.remove('is-dragging');
      try {
        if (root.releasePointerCapture && root.hasPointerCapture && root.hasPointerCapture(pointerId)) {
          root.releasePointerCapture(pointerId);
        }
      } catch (error) {
        // Nothing else is needed when capture has already been released by the browser.
      }
      syncPriceControls('init');
      refreshListing();
    }

    root.addEventListener('pointerdown', onPointerDown, { passive: false });
    root.addEventListener('pointermove', onPointerMove, { passive: false });
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('lostpointercapture', onPointerUp);
  }

  function resetPriceControls() {
    if (!dom.filterMinRange && !dom.filterMaxRange) {
      if (dom.filterMin) dom.filterMin.value = '';
      if (dom.filterMax) dom.filterMax.value = '';
      return;
    }
    if (dom.filterMinRange) dom.filterMinRange.value = String(PRICE_FILTER.min);
    if (dom.filterMaxRange) dom.filterMaxRange.value = String(PRICE_FILTER.max);
    if (dom.filterMin) dom.filterMin.value = String(PRICE_FILTER.min);
    if (dom.filterMax) dom.filterMax.value = String(PRICE_FILTER.max);
    syncPriceControls('init');
  }

  function readFilters() {
    const num = el => {
      if (!el || String(el.value).trim() === '') return null;
      const n = Number(el.value);
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const min = dom.filterMinRange ? num(dom.filterMinRange) : num(dom.filterMin);
    const max = dom.filterMaxRange ? num(dom.filterMaxRange) : num(dom.filterMax);
    return {
      search: dom.filterSearch ? normalizeText(dom.filterSearch.value) : '',
      min: min === null ? (dom.filterMinRange ? PRICE_FILTER.min : null) : min,
      max: max === null ? (dom.filterMaxRange ? PRICE_FILTER.max : null) : max,
      stock: dom.filterStock ? dom.filterStock.value : 'all',
      sort: dom.filterSort ? dom.filterSort.value : 'featured'
    };
  }

  function resetFilterInputs(preservePrice) {
    if (dom.filterSearch) dom.filterSearch.value = '';
    if (!preservePrice) {
      if (dom.filterMin) dom.filterMin.value = '';
      if (dom.filterMax) dom.filterMax.value = '';
      resetPriceControls();
    } else if (dom.filterMinRange || dom.filterMaxRange) {
      syncPriceControls('init');
    }
    if (dom.filterStock) dom.filterStock.value = 'all';
    if (dom.filterSort) dom.filterSort.value = 'featured';
  }

  function filterProducts(list, f) {
    const tokens = f.search ? f.search.split(' ') : [];
    return list.filter(p => {
      if (tokens.length) {
        const hay = p.searchIndex.name + ' ' + p.searchIndex.brand + ' ' + p.searchIndex.description;
        if (!tokens.every(t => hay.includes(t))) return false;
      }
      if (f.min !== null && p.price < f.min) return false;
      if (f.max !== null && p.price > f.max) return false;
      if (f.stock === 'in-stock' && p.stock <= 0) return false;
      if (f.stock === 'out-of-stock' && p.stock > 0) return false;
      return true;
    });
  }

  function sortProducts(list, sort, isSearch) {
    const out = list.slice();
    switch (sort) {
      case 'price-asc': return out.sort((a, b) => (a.price - b.price) || (a.order - b.order));
      case 'price-desc': return out.sort((a, b) => (b.price - a.price) || (a.order - b.order));
      case 'newest':
        // createdAt (when configured) → new-arrival flag → catalogue order. No dates are invented.
        return out.sort((a, b) => {
          const byDate = sortNewest(a, b);
          if (a.createdAt || b.createdAt) return byDate;
          return (Number(b.isNewArrival) - Number(a.isNewArrival)) || (a.order - b.order);
        });
      default:
        // Search results keep their relevance order under "Featured".
        return isSearch ? out : out.sort(byFeaturedThenOrder);
    }
  }

  function renderListingPage(route) {
    const ctx = getListingContext(route);
    if (state.listing.key !== ctx.key) {
      state.listing.key = ctx.key;
      state.listing.visible = CONFIG.pageSize;
      resetFilterInputs(true);
    }
    state.listing.ctx = ctx;

    if (dom.categoryPage) dom.categoryPage.dataset.category = ctx.collection;
    setText(dom.categoryTitle, ctx.title);
    setText(dom.categoryBreadcrumb, ctx.breadcrumb);

    if (dom.categoryDescription) {
      if (ctx.isSearch) {
        dom.categoryDescription.textContent = (activeLanguage === 'bn' ? '“' + ctx.query + '” অনুসন্ধানের ফলাফল। ' : 'Showing results for “' + ctx.query + '”. ');
        const clear = document.createElement('a');
        clear.href = '#/';
        clear.dataset.action = 'clear-search';
        clear.textContent = activeLanguage === 'bn' ? 'অনুসন্ধান মুছুন' : 'Clear search';
        dom.categoryDescription.appendChild(clear);
      } else {
        dom.categoryDescription.textContent = ctx.description;
      }
    }
    renderListingProducts(false);
  }

  function renderListingProducts(append) {
    const ctx = state.listing.ctx;
    if (!ctx || !dom.categoryGrid) return;
    const filters = readFilters();
    const filtered = sortProducts(filterProducts(ctx.base, filters), filters.sort, ctx.isSearch);
    const total = filtered.length;
    const visible = Math.min(state.listing.visible, total);
    const startAt = append ? Math.min(state.listing.rendered, visible) : 0;

    renderProductGrid(dom.categoryGrid, filtered.slice(startAt, visible), { append });
    state.listing.rendered = visible;

    setText(dom.categoryCount, String(total));
    setHidden(dom.categoryEmpty, total > 0);
    const wrapper = dom.loadMore ? dom.loadMore.parentElement : null;
    setHidden(wrapper || dom.loadMore, visible >= total);
  }

  function refreshListing() {
    state.listing.visible = CONFIG.pageSize;
    renderListingProducts(false);
  }

  function clearFilters() {
    resetFilterInputs();
    refreshListing();
  }

  function loadMore() {
    state.listing.visible += CONFIG.pageSize;
    renderListingProducts(true);
  }

  /* ======================================================================
     11. PRODUCT DETAILS & QUICK VIEW
     ====================================================================== */

  function deliveryInfoText() {
    if (activeLanguage === 'bn') {
      let text = 'ঢাকার ভেতরে ডেলিভারি চার্জ ' + formatMoney(DELIVERY.insideDhakaFee) + ' এবং ঢাকার বাইরে ' + formatMoney(DELIVERY.outsideDhakaFee) + '।';
      if (DELIVERY.freeDeliveryMinSubtotal > 0) text += ' ' + formatMoney(DELIVERY.freeDeliveryMinSubtotal) + ' বা তার বেশি অর্ডারে ফ্রি ডেলিভারি।';
      text += ' সঠিক চার্জ চেকআউটে দেখানো হবে।';
      if (DELIVERY.showSampleRateNotice) text += ' (নমুনা চার্জ।)';
      return text;
    }
    let text = 'Delivery fee: ' + formatMoney(DELIVERY.insideDhakaFee) + ' inside Dhaka and ' + formatMoney(DELIVERY.outsideDhakaFee) + ' outside Dhaka.';
    if (DELIVERY.freeDeliveryMinSubtotal > 0) text += ' Free delivery on orders of ' + formatMoney(DELIVERY.freeDeliveryMinSubtotal) + ' or more.';
    text += ' The exact fee is shown at checkout.';
    if (DELIVERY.showSampleRateNotice) text += ' (Sample rates.)';
    return text;
  }

  function detailMaxQty(p) { return Math.max(1, getStockLimit(p)); }

  function renderProductPage(p) {
    if (!p || !dom.detailPage) return;
    state.detail = { productId: p.id, qty: 1, selections: {} };
    dom.detailPage.dataset.productId = p.id;

    // Breadcrumb
    const cat = CATEGORIES.find(c => c.id === p.category);
    if (dom.detailBreadcrumbCategory) {
      dom.detailBreadcrumbCategory.dataset.category = p.category;
      dom.detailBreadcrumbCategory.textContent = cat ? (activeLanguage === 'bn' ? CATEGORY_BN[cat.id] : cat.name) : (activeLanguage === 'bn' ? 'ক্যাটাগরি' : 'Category');
      dom.detailBreadcrumbCategory.href = '#/' + categoryPath(p.category);
    }
    setText(dom.detailBreadcrumbProduct, p.name);

    // Gallery
    setImage(dom.detailImage, p.images[0], p.name);
    if (dom.detailThumbs) {
      dom.detailThumbs.replaceChildren();
      if (p.images.length > 1) {
        p.images.forEach((src, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.dataset.action = 'select-thumbnail';
          btn.dataset.index = String(i);
          btn.setAttribute('aria-label', 'Show image ' + (i + 1) + ' of ' + p.images.length);
          if (i === 0) btn.setAttribute('aria-current', 'true');
          const img = document.createElement('img');
          img.width = 72; img.height = 72; img.loading = 'lazy';
          setImage(img, src, '');
          btn.appendChild(img);
          dom.detailThumbs.appendChild(btn);
        });
      }
    }

    // Text fields (always textContent)
    setText(dom.detailId, p.id);
    setText(dom.detailName, p.name);
    if (dom.detailBrand) { dom.detailBrand.textContent = p.brand ? (activeLanguage === 'bn' ? 'ব্র্যান্ড: ' : 'Brand: ') + p.brand : ''; dom.detailBrand.hidden = !p.brand; }
    setHidden(dom.detailRating, true); // no ratings exist, so none are shown
    setText(dom.detailPrice, formatMoney(p.price));
    if (dom.detailOriginal) {
      dom.detailOriginal.textContent = hasDiscount(p) ? formatMoney(p.originalPrice) : '';
      dom.detailOriginal.hidden = !hasDiscount(p);
    }
    const offer = getOfferLabel(p);
    if (dom.detailOffer) { dom.detailOffer.textContent = offer; dom.detailOffer.hidden = !offer; }
    setText(dom.detailStock, getStockLabel(p));
    setText(dom.detailDescription, p.description || (activeLanguage === 'bn' ? 'এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।' : 'No description has been added for this product yet.'));

    // Specifications
    if (dom.detailSpecs) {
      dom.detailSpecs.replaceChildren();
      p.specs.forEach(pair => {
        const li = document.createElement('li');
        li.textContent = pair[0] + ': ' + pair[1];
        dom.detailSpecs.appendChild(li);
      });
      const heading = dom.detailSpecs.previousElementSibling;
      if (heading && heading.tagName === 'H2') heading.hidden = p.specs.length === 0;
    }

    renderVariantControls(p);

    // Delivery / warranty / return
    const para = el => (el ? $('p', el) : null);
    setText(para(dom.detailDelivery), deliveryInfoText());
    if (dom.detailWarranty) {
      setHidden(dom.detailWarranty, !p.warranty);
      setText(para(dom.detailWarranty), p.warranty);
    }
    setText(para(dom.detailReturn), TEXT.returnPolicy);

    // Actions
    [dom.detailAdd, dom.detailBuy, dom.detailWishlist].forEach(btn => { if (btn) btn.dataset.productId = p.id; });
    const soldOut = p.stock <= 0;
    if (dom.detailAdd) dom.detailAdd.disabled = soldOut;
    if (dom.detailBuy) dom.detailBuy.disabled = soldOut;
    if (dom.detailWishlist) syncWishlistButton(dom.detailWishlist, p.id);
    updateQuantityUi('detail');

    // Related products: next items of the same category (wraps around), never the product itself
    const sameCategory = PUBLIC_PRODUCTS.filter(x => x.category === p.category);
    const startIndex = sameCategory.findIndex(x => x.id === p.id);
    const related = [];
    for (let i = 1; i < sameCategory.length && related.length < CONFIG.relatedProducts; i++) {
      related.push(sameCategory[(startIndex + i) % sameCategory.length]);
    }
    renderProductGrid(dom.relatedGrid, related);
    setHidden(dom.relatedSection, related.length === 0);
  }

  function renderVariantControls(p) {
    const fieldset = dom.detailVariants;
    if (!fieldset) return;
    Array.from(fieldset.children).forEach(child => { if (child.tagName !== 'LEGEND') fieldset.removeChild(child); });
    if (!p.variants.length) { fieldset.hidden = true; return; }

    p.variants.forEach((group, i) => {
      state.detail.selections[group.name] = group.options[0];
      const wrap = document.createElement('div');
      wrap.className = 'form-field';
      const id = 'detail-variant-' + i;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = group.name;
      const select = document.createElement('select');
      select.id = id;
      select.dataset.variantName = group.name;
      group.options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = option;
        opt.textContent = option;
        select.appendChild(opt);
      });
      wrap.appendChild(label);
      wrap.appendChild(select);
      fieldset.appendChild(wrap);
    });
    fieldset.hidden = false;
  }

  /** Updates quantity output + disables +/- at the limits. kind: 'detail' | 'quick' */
  function updateQuantityUi(kind) {
    const isDetail = kind === 'detail';
    const productId = isDetail ? state.detail.productId : state.quickView.productId;
    const p = PUBLIC_BY_ID.get(productId);
    const qtyState = isDetail ? state.detail : state.quickView;
    const output = isDetail ? dom.detailQty : dom.qvQty;
    const minus = isDetail ? dom.detailMinus : dom.qvMinus;
    const plus = isDetail ? dom.detailPlus : dom.qvPlus;
    if (!p) return;
    const max = detailMaxQty(p);
    qtyState.qty = clamp(qtyState.qty, 1, max);
    setText(output, String(qtyState.qty));
    const soldOut = p.stock <= 0;
    if (minus) minus.disabled = soldOut || qtyState.qty <= 1;
    if (plus) plus.disabled = soldOut || qtyState.qty >= max;
  }

  function openQuickView(productId) {
    const p = PUBLIC_BY_ID.get(productId);
    const dialog = dom.quickView;
    if (!p || !dialog) return;
    state.quickView = { productId: p.id, qty: 1 };

    setImage(dom.qvImage, p.image, p.name);
    setText(dom.qvTitle, p.name);
    if (dom.qvPrice) {
      dom.qvPrice.textContent = formatMoney(p.price);
      if (hasDiscount(p)) {
        const old = document.createElement('del');
        old.textContent = formatMoney(p.originalPrice);
        old.style.marginLeft = '8px';
        old.style.fontSize = '0.875rem';
        old.style.fontWeight = '400';
        old.style.color = 'var(--text-muted)';
        dom.qvPrice.appendChild(old);
      }
    }
    setText(dom.qvDescription, p.description);
    if (dom.qvLink) { dom.qvLink.dataset.productId = p.id; dom.qvLink.href = '#/' + productPath(p.id); }
    if (dom.qvAdd) {
      dom.qvAdd.dataset.productId = p.id;
      dom.qvAdd.disabled = p.stock <= 0;
      dom.qvAdd.textContent = p.stock <= 0 ? (activeLanguage === 'bn' ? 'স্টকে নেই' : 'Out of Stock') : (activeLanguage === 'bn' ? 'কার্টে যোগ করুন' : 'Add to Cart');
    }
    updateQuantityUi('quick');

    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
  }

  function closeQuickView() {
    const dialog = dom.quickView;
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  }

  function selectThumbnail(button) {
    const p = PUBLIC_BY_ID.get(state.detail.productId);
    if (!p) return;
    const index = Number(button.dataset.index);
    if (!p.images[index]) return;
    setImage(dom.detailImage, p.images[index], p.name);
    $$('button', dom.detailThumbs).forEach(b => {
      if (b === button) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  /* ======================================================================
     12. SHOPPING CART (central state, coupons, totals)
     ====================================================================== */

  function variantSignature(variant) {
    return variant ? Object.keys(variant).sort().map(k => k + '=' + variant[k]).join(';') : '';
  }
  function makeLineKey(productId, variant) { return productId + '|' + variantSignature(variant); }
  function variantText(variant) {
    return variant ? Object.keys(variant).map(k => k + ': ' + variant[k]).join(', ') : '';
  }

  /** Returns a clean, ordered selection object or null when the selection is incomplete/invalid. */
  function normalizeVariantSelection(product, selection) {
    if (!product.variants.length) return null;
    if (!selection || typeof selection !== 'object') return null;
    const clean = {};
    for (const group of product.variants) {
      const value = selection[group.name];
      if (typeof value !== 'string' || !group.options.includes(value)) return null;
      clean[group.name] = value;
    }
    return clean;
  }

  function cartQtyForProduct(productId, exceptKey) {
    return state.cart.lines
      .filter(l => l.productId === productId && l.key !== exceptKey)
      .reduce((sum, l) => sum + l.qty, 0);
  }

  function cartItemCount() { return state.cart.lines.reduce((sum, l) => sum + l.qty, 0); }

  /** Loads and validates stored cart data. Anything unknown, malformed or unavailable is dropped. */
  function loadCart() {
    const raw = storage.read(KEYS.cart, null);
    const cart = { lines: [], couponCode: '' };
    let dropped = 0;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines)) return { cart, dropped };

    raw.lines.forEach(entry => {
      const p = entry && typeof entry.productId === 'string' ? PUBLIC_BY_ID.get(entry.productId) : null;
      if (!p || p.stock <= 0) { dropped++; return; }
      let variant = null;
      if (p.variants.length) {
        variant = normalizeVariantSelection(p, entry.variant);
        if (!variant) { dropped++; return; }
      }
      const key = makeLineKey(p.id, variant);
      const qty = Math.floor(Number(entry.qty));
      if (!Number.isFinite(qty) || qty < 1) { dropped++; return; }
      const existing = cart.lines.find(l => l.key === key);
      const room = getStockLimit(p) - cart.lines.filter(l => l.productId === p.id && l.key !== key).reduce((s, l) => s + l.qty, 0);
      if (existing) existing.qty = Math.min(existing.qty + qty, room);
      else cart.lines.push({ key, productId: p.id, variant, qty: Math.min(qty, Math.max(room, 1)) });
    });
    if (typeof raw.couponCode === 'string' && COUPONS[raw.couponCode.toUpperCase()]) cart.couponCode = raw.couponCode.toUpperCase();
    return { cart, dropped };
  }

  function persistCart() {
    const ok = storage.write(KEYS.cart, {
      lines: state.cart.lines.map(l => ({ productId: l.productId, variant: l.variant, qty: l.qty })),
      couponCode: state.cart.couponCode
    });
    if (!ok && !storage.available && !state.storageNoticeShown) {
      state.storageNoticeShown = true;
      toast.show('Your browser is blocking saved data, so the cart will be lost if you refresh the page.');
    }
  }

  function addToCart(productId, qty, variant) {
    const p = PUBLIC_BY_ID.get(productId);
    if (!p) { toast.show('This product is not available.', { type: 'error' }); return false; }
    if (p.stock <= 0) { toast.show('Sorry, this product is out of stock.', { type: 'error' }); return false; }

    let selection = null;
    if (p.variants.length) {
      selection = normalizeVariantSelection(p, variant);
      if (!selection) { toast.show('Please choose all product options first.', { type: 'error' }); return false; }
    }
    const wanted = Math.max(1, Math.floor(Number(qty) || 1));
    const limit = getStockLimit(p);
    const room = limit - cartQtyForProduct(p.id);
    if (room <= 0) {
      toast.show('You already have the maximum available quantity (' + limit + ') of this product in your cart.', { type: 'error' });
      return false;
    }
    const toAdd = Math.min(wanted, room);
    const key = makeLineKey(p.id, selection);
    const existing = state.cart.lines.find(l => l.key === key);
    if (existing) existing.qty += toAdd;
    else state.cart.lines.push({ key, productId: p.id, variant: selection, qty: toAdd });

    persistCart();
    syncCartUi();

    const viewCart = { label: 'View Cart', onClick: () => navigate('cart') };
    if (toAdd < wanted) toast.show('Only ' + limit + ' available. Quantity adjusted to the maximum in your cart.', { action: viewCart });
    else toast.show('“' + p.name + '” added to your cart.', { type: 'success', action: viewCart });
    return true;
  }

  function setLineQty(key, qty) {
    const line = state.cart.lines.find(l => l.key === key);
    if (!line) return;
    const p = PUBLIC_BY_ID.get(line.productId);
    if (!p) { removeLine(key); return; }
    const limit = getStockLimit(p);
    const room = limit - cartQtyForProduct(p.id, key);
    const next = clamp(Math.floor(qty), 1, Math.max(room, 1));
    if (qty > room) toast.show('Only ' + limit + ' available for this product.', { type: 'error' });
    line.qty = next;
    persistCart();
    syncCartUi();
  }

  function changeLineQty(key, delta) {
    const line = state.cart.lines.find(l => l.key === key);
    if (line) setLineQty(key, line.qty + delta);
  }

  function removeLine(key) {
    state.cart.lines = state.cart.lines.filter(l => l.key !== key);
    persistCart();
    syncCartUi();
  }

  function clearCart() {
    state.cart = { lines: [], couponCode: '' };
    persistCart();
    syncCartUi();
  }

  /** Drops cart lines whose product is no longer published, out of stock, or over the stock limit. */
  function reconcileCartWithCatalogue() {
    const issues = [];
    state.cart.lines = state.cart.lines.filter(line => {
      const p = PUBLIC_BY_ID.get(line.productId);
      if (!p || p.stock <= 0) { issues.push('An item is no longer available and was removed.'); return false; }
      return true;
    });
    state.cart.lines.forEach(line => {
      const p = PUBLIC_BY_ID.get(line.productId);
      const room = getStockLimit(p) - cartQtyForProduct(p.id, line.key);
      if (line.qty > room) {
        line.qty = Math.max(1, room);
        issues.push('The quantity of “' + p.name + '” was reduced to the available stock.');
      }
    });
    return issues;
  }

  /* ---- Coupons & totals ---- */
  function evaluateCoupon(code, subtotal) {
    const key = String(code || '').trim().toUpperCase();
    if (!key) return { ok: false, discount: 0, message: '' };
    const coupon = COUPONS[key];
    if (!coupon) return { ok: false, discount: 0, message: 'That coupon code is not valid.' };
    if (subtotal < (coupon.minSubtotal || 0)) {
      return { ok: false, discount: 0, message: 'This coupon needs a minimum order of ' + formatMoney(coupon.minSubtotal) + '.' };
    }
    let discount = coupon.type === 'percent' ? Math.floor(subtotal * coupon.value / 100) : coupon.value;
    if (coupon.maxDiscount) discount = Math.min(discount, coupon.maxDiscount);
    discount = clamp(Math.floor(discount), 0, subtotal);
    return { ok: true, discount, message: 'Coupon ' + key + ' applied.' };
  }

  function deliveryFeeFor(districtValue, afterDiscount) {
    if (!districtValue) return null;
    if (DELIVERY.freeDeliveryMinSubtotal > 0 && afterDiscount >= DELIVERY.freeDeliveryMinSubtotal) return 0;
    return districtValue === DELIVERY.insideDhakaDistrict ? DELIVERY.insideDhakaFee : DELIVERY.outsideDhakaFee;
  }

  function calculateTotals(lines, couponCode, districtValue) {
    const subtotal = lines.reduce((sum, line) => {
      const p = PUBLIC_BY_ID.get(line.productId);
      return p ? sum + p.price * line.qty : sum;
    }, 0);
    const coupon = evaluateCoupon(couponCode, subtotal);
    const discount = coupon.ok ? coupon.discount : 0;
    const afterDiscount = Math.max(0, subtotal - discount);
    const delivery = deliveryFeeFor(districtValue, afterDiscount);
    const grandTotal = Math.max(0, afterDiscount + (delivery || 0));
    return { subtotal, discount, delivery, grandTotal, couponValid: coupon.ok };
  }

  function applyCoupon() {
    if (state.cart.couponCode) { // button currently acts as "Remove"
      state.cart.couponCode = '';
      if (dom.couponInput) dom.couponInput.value = '';
      persistCart();
      syncCartUi();
      toast.show('Coupon removed.');
      return;
    }
    const code = dom.couponInput ? dom.couponInput.value.trim() : '';
    if (!code) { toast.show('Enter a coupon code first.', { type: 'error' }); if (dom.couponInput) dom.couponInput.focus(); return; }
    if (!state.cart.lines.length) { toast.show('Add a product to your cart before applying a coupon.', { type: 'error' }); return; }
    const subtotal = calculateTotals(state.cart.lines, '', '').subtotal;
    const result = evaluateCoupon(code, subtotal);
    if (!result.ok) {
      if (dom.couponInput) dom.couponInput.setAttribute('aria-invalid', 'true');
      toast.show(result.message, { type: 'error' });
      return;
    }
    if (dom.couponInput) dom.couponInput.removeAttribute('aria-invalid');
    state.cart.couponCode = code.toUpperCase();
    persistCart();
    syncCartUi();
    toast.show(result.message + ' (Test coupon)', { type: 'success' });
  }

  /* ---- Cart UI (header badge, cart page, checkout summary) ---- */
  function updateCartBadge() {
    const count = cartItemCount();
    $$('[data-cart-count]').forEach(el => { el.textContent = count > 99 ? '99+' : String(count); });
    if (dom.cartButton) {
      dom.cartButton.setAttribute('aria-label', 'Open shopping cart, ' + count + (count === 1 ? ' item' : ' items'));
    }
  }

  function renderCartPage() {
    const container = dom.cartItems;
    if (!container || !dom.cartTemplate) return;

    // Remember keyboard focus so it survives the re-render.
    const active = document.activeElement;
    let focusInfo = null;
    if (active && container.contains(active)) {
      const row = active.closest('.cart-item');
      if (row) focusInfo = { key: row.dataset.lineKey, action: active.dataset.action };
    }

    const frag = document.createDocumentFragment();
    state.cart.lines.forEach(line => {
      const p = PUBLIC_BY_ID.get(line.productId);
      if (!p) return;
      const row = dom.cartTemplate.content.firstElementChild.cloneNode(true);
      row.dataset.productId = p.id;
      row.dataset.lineKey = line.key;
      setImage($('[data-field="image"]', row), p.image, p.name);
      setText($('[data-field="name"]', row), p.name);
      setText($('[data-field="variant"]', row), variantText(line.variant));
      setText($('[data-field="unitPrice"]', row), formatMoney(p.price));
      setText($('[data-field="quantity"]', row), String(line.qty));
      setText($('[data-field="lineSubtotal"]', row), formatMoney(p.price * line.qty));
      $$('[data-action]', row).forEach(btn => { btn.dataset.productId = p.id; btn.dataset.lineKey = line.key; });

      const room = getStockLimit(p) - cartQtyForProduct(p.id, line.key);
      const minus = $('[data-action="quantity-minus"]', row);
      const plus = $('[data-action="quantity-plus"]', row);
      if (minus) minus.disabled = line.qty <= 1;
      if (plus) plus.disabled = line.qty >= room;
      frag.appendChild(row);
    });
    container.replaceChildren(frag);
    setHidden(dom.cartEmpty, state.cart.lines.length > 0);

    if (focusInfo) {
      let target = null;
      const row = $$('.cart-item', container).find(r => r.dataset.lineKey === focusInfo.key);
      if (row) {
        target = $('[data-action="' + focusInfo.action + '"]:not(:disabled)', row) || $('[data-action="quantity-plus"]:not(:disabled), [data-action="quantity-minus"]:not(:disabled)', row);
      }
      (target || dom.checkoutButton || container).focus && (target || dom.checkoutButton).focus();
    }

    // Totals (delivery is calculated at checkout, once the district is known)
    const totals = calculateTotals(state.cart.lines, state.cart.couponCode, '');
    setText(dom.cartSubtotal, formatMoney(totals.subtotal));
    setText(dom.cartDiscount, totals.discount > 0 ? '- ' + formatMoney(totals.discount) : formatMoney(0));
    setText(dom.cartDelivery, state.cart.lines.length ? 'Calculated at checkout' : formatMoney(0));
    setText(dom.cartTotal, formatMoney(totals.grandTotal));
    if (dom.checkoutButton) dom.checkoutButton.disabled = state.cart.lines.length === 0;

    // Coupon field: shows the applied code and turns the button into "Remove".
    if (dom.couponButton) {
      if (!dom.couponButton.dataset.defaultLabel) dom.couponButton.dataset.defaultLabel = dom.couponButton.textContent.trim() || 'Apply Coupon';
      dom.couponButton.textContent = state.cart.couponCode ? 'Remove' : dom.couponButton.dataset.defaultLabel;
    }
    if (dom.couponInput) {
      dom.couponInput.readOnly = !!state.cart.couponCode;
      if (state.cart.couponCode) { dom.couponInput.value = state.cart.couponCode; dom.couponInput.removeAttribute('aria-invalid'); }
    }
  }

  function syncCartUi() {
    // Drop a coupon whose conditions are no longer met (e.g. subtotal fell below the minimum).
    if (state.cart.couponCode) {
      const subtotal = calculateTotals(state.cart.lines, '', '').subtotal;
      const result = evaluateCoupon(state.cart.couponCode, subtotal);
      if (!result.ok) {
        const message = state.cart.lines.length ? 'Coupon removed: ' + result.message : '';
        state.cart.couponCode = '';
        persistCart();
        if (message) toast.show(message);
      }
    }
    updateCartBadge();
    renderCartPage();
    renderCheckoutSummary();
  }

  /* ======================================================================
     13. WISHLIST
     ====================================================================== */

  function loadWishlist() {
    const raw = storage.read(KEYS.wishlist, []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.filter(id => typeof id === 'string' && PUBLIC_BY_ID.has(id) && !seen.has(id) && seen.add(id));
  }

  function persistWishlist() { storage.write(KEYS.wishlist, state.wishlist); }

  function syncWishlistButton(button, productId) {
    const saved = state.wishlist.includes(productId);
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    button.setAttribute('aria-label', saved ? 'Remove from wishlist' : 'Add to wishlist');
    const text = $('.button-text', button);
    if (text) text.textContent = activeLanguage === 'bn' ? (saved ? 'সংরক্ষিত' : 'ইচ্ছেতালিকা') : (saved ? 'Saved' : 'Wishlist');
  }

  function syncAllWishlistButtons() {
    $$('.wishlist-button[data-product-id], #detail-wishlist').forEach(btn => {
      if (btn.dataset.productId) syncWishlistButton(btn, btn.dataset.productId);
    });
  }

  function toggleWishlist(productId) {
    const p = PUBLIC_BY_ID.get(productId);
    if (!p) return;
    const index = state.wishlist.indexOf(productId);
    if (index >= 0) { state.wishlist.splice(index, 1); toast.show('Removed from your wishlist.'); }
    else { state.wishlist.push(productId); toast.show('“' + p.name + '” saved to your wishlist.', { type: 'success' }); }
    persistWishlist();
    syncAllWishlistButtons();
    if (state.route.name === 'wishlist') renderWishlistPage();
  }

  function renderWishlistPage() {
    const items = state.wishlist.map(id => PUBLIC_BY_ID.get(id)).filter(Boolean);
    renderProductGrid(dom.wishlistGrid, items);
    setHidden(dom.wishlistEmpty, items.length > 0);
  }

  /* ======================================================================
     14. CHECKOUT & VALIDATION
     ====================================================================== */

  function populateDistricts(divisionValue) {
    const select = dom.district;
    if (!select) return;
    Array.from(select.options).forEach((opt, i) => { if (i > 0) select.removeChild(opt); });
    (DIVISION_DISTRICTS[divisionValue] || []).forEach(name => {
      const opt = document.createElement('option');
      opt.value = slugify(name);
      opt.textContent = name;
      select.appendChild(opt);
    });
    select.value = '';
  }

  function renderCheckoutSummary() {
    if (!dom.checkoutItems) return;
    const frag = document.createDocumentFragment();
    state.cart.lines.forEach(line => {
      const p = PUBLIC_BY_ID.get(line.productId);
      if (!p) return;
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '12px' });
      const name = document.createElement('span');
      const variant = variantText(line.variant);
      name.textContent = p.name + (variant ? ' (' + variant + ')' : '') + ' × ' + line.qty;
      const price = document.createElement('span');
      price.textContent = formatMoney(p.price * line.qty);
      price.style.whiteSpace = 'nowrap';
      row.appendChild(name);
      row.appendChild(price);
      frag.appendChild(row);
    });
    dom.checkoutItems.replaceChildren(frag);

    const district = dom.district ? dom.district.value : '';
    const totals = calculateTotals(state.cart.lines, state.cart.couponCode, district);
    setText(dom.checkoutSubtotal, formatMoney(totals.subtotal));
    setText(dom.checkoutDiscount, totals.discount > 0 ? '- ' + formatMoney(totals.discount) : formatMoney(0));
    setText(dom.checkoutDelivery, totals.delivery === null ? 'Select district' : (totals.delivery === 0 ? 'Free' : formatMoney(totals.delivery)));
    setText(dom.checkoutTotal, formatMoney(totals.grandTotal));
  }

  function setFieldError(input, message) {
    if (!input) return;
    const error = byId(input.id + '-error');
    if (message) {
      input.setAttribute('aria-invalid', 'true');
      if (error) { error.textContent = message; error.hidden = false; }
    } else {
      input.removeAttribute('aria-invalid');
      if (error) { error.textContent = ''; error.hidden = true; }
    }
  }

  function readCheckoutValues() {
    const value = id => { const el = byId(id); return el ? el.value.trim() : ''; };
    const checked = dom.checkoutForm ? $('input[name="paymentMethod"]:checked', dom.checkoutForm) : null;
    const terms = byId('checkout-terms');
    return {
      fullName: value('customer-full-name'),
      phoneRaw: value('customer-phone'),
      division: value('customer-division'),
      district: value('customer-district'),
      upazila: value('customer-upazila'),
      address: value('customer-address'),
      instructions: value('delivery-instructions'),
      paymentMethod: checked ? checked.value : '',
      termsAccepted: !!(terms && terms.checked)
    };
  }

  function validateCheckout(v) {
    const errors = []; // in page order
    const add = (id, message) => errors.push({ el: byId(id), message });

    if (v.fullName.length < 2) add('customer-full-name', 'Please enter your full name.');
    else if (v.fullName.length > 100) add('customer-full-name', 'Name is too long (100 characters maximum).');

    const phone = normalizeBdPhone(v.phoneRaw);
    if (!v.phoneRaw) add('customer-phone', 'Please enter your mobile number.');
    else if (!phone) add('customer-phone', 'Enter a valid Bangladesh mobile number, like 01XXXXXXXXX or +8801XXXXXXXXX.');

    if (!v.division || !DIVISION_DISTRICTS[v.division]) add('customer-division', 'Please select your division.');
    if (!v.district) add('customer-district', 'Please select your district.');
    else if (DIVISION_DISTRICTS[v.division] && !DIVISION_DISTRICTS[v.division].some(n => slugify(n) === v.district)) {
      add('customer-district', 'Please select a district that belongs to the chosen division.');
    }
    if (v.upazila.length < 2) add('customer-upazila', 'Please enter your upazila or area.');
    if (v.address.length < 6) add('customer-address', 'Please enter a detailed delivery address (house, road, landmark).');
    else if (v.address.length > 300) add('customer-address', 'Address is too long (300 characters maximum).');
    if (!v.termsAccepted) add('checkout-terms', 'Please accept the Terms & Conditions and Return & Refund Policy to continue.');

    return { errors, phone };
  }

  function generateOrderId() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    for (let attempt = 0; attempt < 20; attempt++) {
      let suffix = '';
      const bytes = new Uint8Array(5);
      if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
      else for (let i = 0; i < 5; i++) bytes[i] = Math.floor(Math.random() * 256);
      bytes.forEach(b => { suffix += alphabet[b % alphabet.length]; });
      const id = CONFIG.orderIdPrefix + '-' + date + '-' + suffix;
      if (!findOrder(id)) return id;
    }
    return CONFIG.orderIdPrefix + '-' + date + '-' + Date.now().toString(36).toUpperCase();
  }

  function checkoutSignature(values, phone, totals) {
    return JSON.stringify({
      customer: { fullName: values.fullName, phone },
      address: {
        division: values.division, district: values.district,
        upazila: values.upazila, line: values.address, instructions: values.instructions
      },
      paymentMethod: values.paymentMethod,
      couponCode: totals.couponValid ? state.cart.couponCode : '',
      lines: state.cart.lines.map(line => {
        const product = PUBLIC_BY_ID.get(line.productId);
        return {
          productId: line.productId,
          name: product ? product.name : '',
          variant: line.variant || {},
          qty: line.qty,
          unitPrice: product ? product.price : null
        };
      }),
      totals: {
        subtotal: totals.subtotal, discount: totals.discount,
        delivery: totals.delivery, grandTotal: totals.grandTotal
      }
    });
  }

  function savePendingOrder(order) {
    state.pendingOrder = order;
    storage.write(KEYS.pendingOrder, order);
  }

  function rememberPendingOrder(order) {
    const existingIndex = state.orders.findIndex(item => item.id === order.id);
    if (existingIndex >= 0) state.orders[existingIndex] = order;
    else state.orders.unshift(order);
    state.orders = state.orders.slice(0, CONFIG.maxStoredOrders);
    if (CONFIG.persistOrderHistory) storage.write(KEYS.orders, state.orders);
    state.lastOrderId = order.id;
  }

  // Submit the order with a normal form POST, then verify its Order ID using
  // the Apps Script status endpoint. This avoids relying on cross-origin access
  // to the iframe response or postMessage through Apps Script's sandbox.
  function submitOrderToGoogleSheets(order) {
    return new Promise((resolve, reject) => {
      if (!GOOGLE_SHEETS_WEB_APP_URL) {
        reject(new Error('Google Sheets order endpoint is not configured.'));
        return;
      }

      const frameName = 'shobpaben-order-frame-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      const iframe = document.createElement('iframe');
      iframe.name = frameName;
      iframe.title = 'Order submission response';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'display:none!important;width:0;height:0;border:0';

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = GOOGLE_SHEETS_WEB_APP_URL;
      form.target = frameName;
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';

      const payload = document.createElement('input');
      payload.type = 'hidden';
      payload.name = 'payload';
      payload.value = JSON.stringify(order);
      form.appendChild(payload);

      // Honeypot field: real customers never see or fill this field.
      const honeypot = document.createElement('input');
      honeypot.type = 'text';
      honeypot.name = 'website';
      honeypot.value = '';
      honeypot.autocomplete = 'off';
      honeypot.tabIndex = -1;
      honeypot.setAttribute('aria-hidden', 'true');
      honeypot.style.cssText = 'display:none!important';
      form.appendChild(honeypot);

      let finished = false;
      let timeoutId = null;
      let pollTimer = null;
      let activeScript = null;
      let activeCallback = '';

      const cleanup = () => {
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        if (pollTimer !== null) window.clearTimeout(pollTimer);
        if (activeScript) activeScript.remove();
        if (activeCallback) {
          try { delete window[activeCallback]; } catch (e) { window[activeCallback] = undefined; }
        }
        form.remove();
        iframe.remove();
      };

      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        cleanup();
        callback(value);
      };

      const verifySavedOrder = () => {
        if (finished) return;
        const callbackName = '__shobpOrderCheck_' + Date.now() + '_' + Math.floor(Math.random() * 1000000);
        const script = document.createElement('script');
        const separator = GOOGLE_SHEETS_WEB_APP_URL.indexOf('?') === -1 ? '?' : '&';
        activeCallback = callbackName;
        activeScript = script;

        const retry = () => {
          if (finished) return;
          if (script.parentNode) script.parentNode.removeChild(script);
          activeScript = null;
          if (activeCallback) {
            try { delete window[activeCallback]; } catch (e) { window[activeCallback] = undefined; }
            activeCallback = '';
          }
          pollTimer = window.setTimeout(verifySavedOrder, 900);
        };

        window[callbackName] = data => {
          if (finished) return;
          if (!data || data.type !== 'shobpaben-order-status' || data.success !== true) {
            retry();
            return;
          }
          if (String(data.orderId || '') !== String(order.id)) {
            finish(reject, new Error('Google Sheets returned a status for a different Order ID.'));
            return;
          }
          if (data.exists === true) {
            finish(resolve, { type: 'shobpaben-order-result', success: true, orderId: String(order.id), message: 'Order saved or already saved.' });
            return;
          }
          retry();
        };

        script.onerror = retry;
        script.onload = () => {
          // A valid JSONP response invokes the callback. If it did not, retry.
          window.setTimeout(() => {
            if (activeCallback === callbackName && !finished) retry();
          }, 100);
        };
        script.src = GOOGLE_SHEETS_WEB_APP_URL + separator +
          'action=orderStatus&orderId=' + encodeURIComponent(order.id) +
          '&callback=' + encodeURIComponent(callbackName) +
          '&_=' + Date.now();
        (document.head || document.body).appendChild(script);
      };

      document.body.appendChild(iframe);
      document.body.appendChild(form);

      timeoutId = window.setTimeout(() => {
        finish(reject, new Error('Google Sheets did not confirm this Order ID in time. You can retry safely; the same pending Order ID will be checked for an existing save.'));
      }, 30000);

      try {
        form.submit();
        // The save may complete even if the opaque iframe response is lost.
        // Poll the independent status endpoint and require an exact ID match.
        window.setTimeout(verifySavedOrder, 500);
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function onCheckoutSubmit(event) {
    event.preventDefault();
    if (state.isPlacingOrder || !dom.checkoutForm) return;

    $$('.form-field input, .form-field select, .form-field textarea', dom.checkoutForm).forEach(el => setFieldError(el, ''));

    if (!state.cart.lines.length) {
      toast.show('Your cart is empty. Add a product before placing an order.', { type: 'error' });
      navigate('cart');
      return;
    }

    const issues = reconcileCartWithCatalogue();
    if (issues.length) {
      persistCart();
      syncCartUi();
      toast.show(issues[0] + ' Please review your cart.', { type: 'error' });
      navigate('cart');
      return;
    }

    const values = readCheckoutValues();
    const { errors, phone } = validateCheckout(values);
    if (values.paymentMethod !== 'cash-on-delivery') {
      toast.show('Please choose Cash on Delivery. No other payment method is available yet.', { type: 'error' });
      return;
    }
    if (errors.length) {
      errors.forEach(err => setFieldError(err.el, err.message));
      toast.show('Please fix the highlighted fields.', { type: 'error' });
      if (errors[0].el) errors[0].el.focus();
      return;
    }

    state.isPlacingOrder = true;
    if (dom.placeOrder) { dom.placeOrder.disabled = true; dom.placeOrder.setAttribute('aria-busy', 'true'); }

    try {
      const totals = calculateTotals(state.cart.lines, state.cart.couponCode, values.district);
      if (totals.delivery === null) throw new Error('Delivery fee could not be calculated.');
      const signature = checkoutSignature(values, phone, totals);
      const divisionLabel = ($('option:checked', dom.division) || {}).textContent || values.division;
      const districtLabel = ($('option:checked', dom.district) || {}).textContent || values.district;

      // Reuse the same order ID on retry if checkout details have not changed.
      let order = state.pendingOrder && state.pendingOrder.signature === signature ? state.pendingOrder : null;
      if (!order) {
        order = {
          id: generateOrderId(),
          createdAt: new Date().toISOString(),
          isDemo: false,
          status: 'pending_confirmation',
          signature,
          customer: { fullName: values.fullName, phone },
          address: { division: divisionLabel, district: districtLabel, upazila: values.upazila, line: values.address, instructions: values.instructions },
          paymentMethod: 'Cash on Delivery',
          couponCode: totals.couponValid ? state.cart.couponCode : '',
          lines: state.cart.lines.map(line => {
            const p = PUBLIC_BY_ID.get(line.productId);
            return { productId: p.id, name: p.name, variant: variantText(line.variant), unitPrice: p.price, qty: line.qty, lineTotal: p.price * line.qty };
          }),
          totals: { subtotal: totals.subtotal, discount: totals.discount, delivery: totals.delivery, grandTotal: totals.grandTotal }
        };
      }

      // Keep a retryable copy until the Sheet explicitly confirms the order.
      savePendingOrder(order);
      await submitOrderToGoogleSheets(order);

      // Only treat it as submitted once Code.gs confirms that the row was saved.
      order.isDemo = false;
      order.status = 'pending_confirmation';
      rememberPendingOrder(order);
      savePendingOrder(null);

      // Empty the cart after a confirmed submission.
      state.cart.lines = [];
      state.cart.couponCode = '';
      persistCart();
      syncCartUi();

      renderConfirmation(order);
      navigate('order-confirmation');
      // The order is already confirmed and saved; show this same invoice immediately.
      // Re-render after navigation so the cached invoice is current even on a route change.
      renderConfirmation(order);
      openInvoicePopup(order.id);
    } catch (err) {
      console.error('[ShobPaben] Could not submit the order to Google Sheets.', err);
      toast.show(activeLanguage === 'bn'
        ? 'অর্ডার Google Sheet-এ জমা হয়েছে কি না নিশ্চিত হওয়া যায়নি। ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করো। একই checkout details থাকলে একই Order ID ব্যবহার হবে।'
        : 'We could not confirm that your order reached the Google Sheet. Check your connection and try again; the same Order ID will be reused if checkout details are unchanged.', { type: 'error', duration: 9000 });
    } finally {
      state.isPlacingOrder = false;
      if (dom.placeOrder) { dom.placeOrder.disabled = false; dom.placeOrder.removeAttribute('aria-busy'); }
    }
  }

  /* ======================================================================
     15. ORDER CONFIRMATION, INVOICE & ORDER HISTORY
     ====================================================================== */

  function sanitizeOrder(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !Array.isArray(raw.lines) || !raw.totals) return null;
    const str = (v, max) => String(v == null ? '' : v).slice(0, max || 300);
    const num = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };
    const lines = raw.lines
      .filter(l => l && typeof l === 'object')
      .map(l => ({ productId: str(l.productId, 60), name: str(l.name, 200), variant: str(l.variant, 200), unitPrice: num(l.unitPrice), qty: Math.max(1, num(l.qty)), lineTotal: num(l.lineTotal) }));
    if (!lines.length) return null;
    const c = raw.customer || {};
    const a = raw.address || {};
    return {
      id: str(raw.id, 80), createdAt: str(raw.createdAt, 40), isDemo: Boolean(raw.isDemo),
      status: str(raw.status, 60) || (raw.isDemo ? 'pending_whatsapp' : 'pending_confirmation'), signature: str(raw.signature, 12000),
      customer: { fullName: str(c.fullName, 100), phone: str(c.phone, 20) },
      address: { division: str(a.division, 60), district: str(a.district, 60), upazila: str(a.upazila, 100), line: str(a.line, 300), instructions: str(a.instructions, 300) },
      paymentMethod: str(raw.paymentMethod, 60) || 'Cash on Delivery',
      couponCode: str(raw.couponCode, 30),
      lines,
      totals: { subtotal: num(raw.totals.subtotal), discount: num(raw.totals.discount), delivery: num(raw.totals.delivery), grandTotal: num(raw.totals.grandTotal) }
    };
  }

  function loadPendingOrder() {
    const raw = storage.read(KEYS.pendingOrder, null);
    return sanitizeOrder(raw);
  }

  function loadOrders() {
    if (!CONFIG.persistOrderHistory) return [];
    const raw = storage.read(KEYS.orders, []);
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.map(sanitizeOrder).filter(o => o && !seen.has(o.id) && seen.add(o.id)).slice(0, CONFIG.maxStoredOrders);
  }

  function findOrder(id) { return id ? state.orders.find(o => o.id === id) || null : null; }

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso || '';
    try { return date.toLocaleString(activeLanguage === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return date.toISOString(); }
  }

  function renderConfirmation(order) {
    if (!dom.invoice) return;
    if (!order) { navigate(''); return; }

    const title = byId('order-confirmation-title');
    if (title) title.textContent = order.isDemo
      ? 'Your order details are ready'
      : (activeLanguage === 'bn' ? 'আপনার অর্ডার গ্রহণ করা হয়েছে' : 'Your order has been received');
    const notice = dom.confirmationPage ? $(':scope > p', dom.confirmationPage) : null;
    if (notice) notice.textContent = order.isDemo
      ? 'This is an older local demo order and was not sent to the order spreadsheet.'
      : (activeLanguage === 'bn'
          ? 'তোমার অর্ডারের তথ্য ShobPaben-এর কাছে জমা হয়েছে। পণ্য ও ডেলিভারি নিশ্চিত করতে আমরা যোগাযোগ করব।'
          : 'Your order details were submitted to ShobPaben. We will contact you to confirm the order and delivery.');
    if (dom.whatsappOrder) dom.whatsappOrder.textContent = activeLanguage === 'bn' ? 'WhatsApp-এ অর্ডার সম্পর্কে জিজ্ঞাসা করুন' : 'WhatsApp Order Inquiry';

    setText(dom.invoiceOrderId, order.id);
    setText(dom.invoiceDate, formatDateTime(order.createdAt));
    setText(dom.invoicePayment, order.paymentMethod);

    if (dom.invoiceCustomer) {
      dom.invoiceCustomer.replaceChildren();
      [['Name', order.customer.fullName], ['Mobile', order.customer.phone]].forEach(pair => {
        const p = document.createElement('p');
        p.style.margin = '0';
        p.textContent = pair[0] + ': ' + pair[1];
        dom.invoiceCustomer.appendChild(p);
      });
    }
    if (dom.invoiceAddress) {
      dom.invoiceAddress.replaceChildren();
      const a = order.address;
      const lines = [a.line, [a.upazila, a.district, a.division].filter(Boolean).join(', ')];
      if (a.instructions) lines.push('Instructions: ' + a.instructions);
      lines.filter(Boolean).forEach((text, i) => {
        if (i > 0) dom.invoiceAddress.appendChild(document.createElement('br'));
        dom.invoiceAddress.appendChild(document.createTextNode(text));
      });
    }

    if (dom.invoiceItems) {
      const frag = document.createDocumentFragment();
      order.lines.forEach(line => {
        const tr = document.createElement('tr');
        const nameCell = document.createElement('td');
        nameCell.textContent = line.name;
        if (line.variant) {
          const small = document.createElement('div');
          small.textContent = line.variant;
          small.style.fontSize = '0.8125rem';
          small.style.color = 'var(--text-muted)';
          nameCell.appendChild(small);
        }
        const cells = [nameCell];
        [formatMoney(line.unitPrice), String(line.qty), formatMoney(line.lineTotal)].forEach(text => {
          const td = document.createElement('td');
          td.textContent = text;
          cells.push(td);
        });
        cells.forEach(td => tr.appendChild(td));
        frag.appendChild(tr);
      });
      dom.invoiceItems.replaceChildren(frag);
    }

    setText(dom.invoiceSubtotal, formatMoney(order.totals.subtotal));
    setText(dom.invoiceDiscount, order.totals.discount > 0 ? '- ' + formatMoney(order.totals.discount) : formatMoney(0));
    setText(dom.invoiceDelivery, formatMoney(order.totals.delivery));
    setText(dom.invoiceTotal, formatMoney(order.totals.grandTotal));

    if (dom.whatsappOrder) dom.whatsappOrder.href = buildOrderWhatsAppUrl(order);
    dom.invoice.dataset.orderId = order.id;
  }

  function ensureInvoiceDialog() {
    if (state.invoiceDialog && state.invoiceDialog.isConnected) {
      state.invoiceDialog.setAttribute('aria-label', activeLanguage === 'bn' ? 'ইনভয়েস' : 'Invoice');
      return state.invoiceDialog;
    }

    let dialog = byId('shobpaben-invoice-dialog');
    if (!dialog || dialog.tagName.toLowerCase() !== 'dialog') {
      dialog = document.createElement('dialog');
      dialog.id = 'shobpaben-invoice-dialog';
      dialog.setAttribute('aria-label', activeLanguage === 'bn' ? 'ইনভয়েস' : 'Invoice');

      const panel = document.createElement('div');
      panel.className = 'sp-invoice-dialog-panel';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'sp-invoice-dialog-close';
      closeButton.dataset.action = 'close-invoice-popup';
      closeButton.setAttribute('aria-label', activeLanguage === 'bn' ? 'ইনভয়েস বন্ধ করুন' : 'Close invoice');
      closeButton.textContent = '×';
      const content = document.createElement('div');
      content.className = 'sp-invoice-dialog-content';
      panel.append(closeButton, content);
      dialog.appendChild(panel);
      document.body.appendChild(dialog);
    }

    if (!byId('shobpaben-invoice-dialog-styles')) {
      const style = document.createElement('style');
      style.id = 'shobpaben-invoice-dialog-styles';
      style.textContent = `
        #shobpaben-invoice-dialog {
          width: min(860px, calc(100% - 24px)); max-width: 860px;
          max-height: min(92vh, 900px); max-height: min(92dvh, 900px);
          padding: 0; border: 0; border-radius: 16px; overflow: auto;
          color: #1f2937; background: transparent; box-shadow: 0 24px 80px rgba(0,0,0,.28);
        }
        #shobpaben-invoice-dialog::backdrop { background: rgba(12,18,28,.66); backdrop-filter: blur(2px); }
        #shobpaben-invoice-dialog .sp-invoice-dialog-panel {
          position: relative; min-height: 100px; padding: clamp(16px, 3vw, 30px);
          border-radius: 16px; background: #fff;
        }
        #shobpaben-invoice-dialog .sp-invoice-dialog-close {
          position: sticky; top: 0; z-index: 2; display: block; margin: 0 0 8px auto;
          width: 42px; height: 42px; border: 1px solid #d1d5db; border-radius: 50%;
          background: #fff; color: #111827; font: inherit; font-size: 28px; line-height: 1;
          cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.12);
        }
        #shobpaben-invoice-dialog .sp-invoice-dialog-close:focus-visible { outline: 3px solid #287a74; outline-offset: 2px; }
        #shobpaben-invoice-dialog #invoice { width: 100%; max-width: 100%; margin-inline: auto; }
        @media (max-width: 600px) {
          #shobpaben-invoice-dialog { width: calc(100% - 16px); max-height: 94vh; max-height: 94dvh; border-radius: 12px; }
          #shobpaben-invoice-dialog .sp-invoice-dialog-panel { padding: 12px; border-radius: 12px; }
        }
        @media print {
          body.sp-invoice-printing > * { visibility: hidden !important; }
          body.sp-invoice-printing #shobpaben-invoice-dialog {
            display: block !important; position: fixed !important; inset: 0 auto auto 0 !important;
            width: 100% !important; max-width: none !important; height: auto !important; max-height: none !important;
            margin: 0 !important; padding: 0 !important; overflow: visible !important;
            border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
            background: #fff !important; color: #000 !important;
          }
          body.sp-invoice-printing #shobpaben-invoice-dialog,
          body.sp-invoice-printing #shobpaben-invoice-dialog * { visibility: visible !important; }
          body.sp-invoice-printing #shobpaben-invoice-dialog .sp-invoice-dialog-panel { padding: 0 !important; border-radius: 0 !important; }
          body.sp-invoice-printing #shobpaben-invoice-dialog .sp-invoice-dialog-close,
          body.sp-invoice-printing #shobpaben-invoice-dialog [data-action="print-invoice"],
          body.sp-invoice-printing #shobpaben-invoice-dialog #whatsapp-order-button { display: none !important; }
          body.sp-invoice-printing #shobpaben-invoice-dialog #invoice { width: 100% !important; max-width: none !important; margin: 0 !important; }
          body.sp-invoice-printing #shobpaben-invoice-dialog::backdrop { background: transparent !important; }
        }
      `;
      document.head.appendChild(style);
    }

    dialog.addEventListener('click', event => {
      // A click whose target is the dialog itself came from the backdrop, not its contents.
      if (event.target === dialog) closeInvoicePopup();
    });
    dialog.addEventListener('close', restoreInvoiceAfterPopup);
    state.invoiceDialog = dialog;
    return dialog;
  }

  function openInvoicePopup(orderId) {
    if (!dom.invoice || !orderId || dom.invoice.dataset.orderId !== String(orderId)) return false;
    const dialog = ensureInvoiceDialog();
    if (dialog.open) return true;

    const content = $('.sp-invoice-dialog-content', dialog);
    if (!content) return false;
    if (!state.invoicePlaceholder && dom.invoice.parentNode) {
      state.invoicePlaceholder = document.createComment('ShobPaben invoice original position');
      dom.invoice.parentNode.insertBefore(state.invoicePlaceholder, dom.invoice);
    }
    if (state.invoicePlaceholder) content.appendChild(dom.invoice);

    state.invoicePreviousFocus = document.activeElement;
    state.invoiceBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    try {
      if (typeof dialog.showModal !== 'function') throw new Error('This browser does not support an accessible invoice dialog.');
      dialog.showModal();
      const closeButton = $('.sp-invoice-dialog-close', dialog);
      if (closeButton) closeButton.focus({ preventScroll: true });
      return true;
    } catch (error) {
      restoreInvoiceAfterPopup();
      toast.show('The invoice could not be opened as a popup in this browser. The order is confirmed and remains available on the order confirmation page.', { type: 'error', duration: 7000 });
      return false;
    }
  }

  function restoreInvoiceAfterPopup() {
    if (dom.invoice && state.invoicePlaceholder && state.invoicePlaceholder.parentNode) {
      state.invoicePlaceholder.parentNode.insertBefore(dom.invoice, state.invoicePlaceholder);
      state.invoicePlaceholder.remove();
    }
    state.invoicePlaceholder = null;
    if (document.body) document.body.style.overflow = state.invoiceBodyOverflow;

    const previousFocus = state.invoicePreviousFocus;
    state.invoicePreviousFocus = null;
    state.invoiceBodyOverflow = '';
    window.requestAnimationFrame(() => {
      if (previousFocus && previousFocus.isConnected && !previousFocus.disabled && previousFocus.getClientRects().length) {
        previousFocus.focus({ preventScroll: true });
        return;
      }
      const heading = byId('order-confirmation-title');
      if (heading && heading.getClientRects().length) {
        if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    });
  }

  function closeInvoicePopup() {
    const dialog = state.invoiceDialog;
    if (dialog && dialog.open) dialog.close();
    else restoreInvoiceAfterPopup();
  }

  function printInvoice() {
    if (!dom.invoice || !dom.invoice.dataset.orderId) {
      toast.show('There is no invoice to print yet.', { type: 'error' });
      return;
    }
    // If the invoice is on its normal page, move that same invoice into the dialog first.
    if (!openInvoicePopup(dom.invoice.dataset.orderId)) {
      // Preserve the existing print flow as a fallback if native dialogs are unavailable.
      window.print();
      return;
    }
    const body = document.body;
    body.classList.add('sp-invoice-printing');
    const restorePrintState = () => {
      body.classList.remove('sp-invoice-printing');
      window.removeEventListener('afterprint', restorePrintState);
    };
    window.addEventListener('afterprint', restorePrintState, { once: true });
    try {
      window.print();
    } catch (error) {
      restorePrintState();
      toast.show('The invoice could not be sent to the printer. Please try again.', { type: 'error' });
    }
  }

  function renderOrderHistory() {
    const container = dom.orderHistory;
    if (!container) return;
    container.replaceChildren();
    setHidden(dom.orderHistoryEmpty, state.orders.length > 0);
    if (!state.orders.length) return;

    Object.assign(container.style, { display: 'grid', gap: '16px' });
    state.orders.forEach(order => {
      const card = document.createElement('article');
      card.className = 'order-history-entry contact-form'; // reuses the existing card styling
      const heading = document.createElement('h2');
      heading.textContent = 'Order ' + order.id;
      heading.style.fontSize = '1.0625rem';
      const when = document.createElement('p');
      when.style.margin = '0';
      when.textContent = formatDateTime(order.createdAt);
      const items = order.lines.reduce((s, l) => s + l.qty, 0);
      const summary = document.createElement('p');
      summary.style.margin = '0';
      summary.textContent = items + (items === 1 ? ' item' : ' items') + ' · Total ' + formatMoney(order.totals.grandTotal) + (order.isDemo ? ' · Local demo only' : ' · Submitted — awaiting confirmation');
      const link = document.createElement('a');
      link.className = 'view-all-link';
      link.href = '#/order/' + encodeURIComponent(order.id);
      link.textContent = 'View Invoice';
      link.setAttribute('aria-label', 'View invoice for order ' + order.id);
      [heading, when, summary, link].forEach(el => card.appendChild(el));
      container.appendChild(card);
    });
  }

  /* ======================================================================
     16. WHATSAPP INTEGRATION, CONTACT & NEWSLETTER
     ====================================================================== */

  const WHATSAPP_BASE = 'https://wa.me/' + CONFIG.whatsappNumber;

  function buildOrderWhatsAppUrl(order) {
    if (!order) return WHATSAPP_BASE + '?text=' + encodeURIComponent('Hello ShobPaben, I need help with an order.');
    const address = order.address || {};
    const lines = [
      'Hello ShobPaben, I am contacting you about an order submitted through the website.',
      '',
      'Order reference: ' + order.id,
      'Customer: ' + order.customer.fullName,
      'Mobile: ' + order.customer.phone,
      'Delivery address: ' + [address.line, address.upazila, address.district, address.division].filter(Boolean).join(', ')
    ];
    if (address.instructions) lines.push('Delivery instructions: ' + address.instructions);
    lines.push('', 'Items:');
    order.lines.forEach((line, i) => {
      lines.push((i + 1) + '. ' + line.name + (line.variant ? ' (' + line.variant + ')' : '') +
        ' — ' + line.qty + ' × ' + formatMoney(line.unitPrice) + ' = ' + formatMoney(line.lineTotal));
    });
    lines.push('', 'Cart subtotal: ' + formatMoney(order.totals.subtotal));
    if (order.couponCode) lines.push('Coupon discount (' + order.couponCode + '): -' + formatMoney(order.totals.discount));
    else lines.push('Coupon discount: ' + formatMoney(order.totals.discount));
    lines.push('Delivery fee: ' + formatMoney(order.totals.delivery));
    lines.push('Grand total: ' + formatMoney(order.totals.grandTotal));
    lines.push('Payment preference: ' + (order.paymentMethod || 'Cash on Delivery'));
    lines.push('', 'Please help me check or confirm this order.');
    return WHATSAPP_BASE + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  function setupWhatsAppLinks() {
    $$('a[href^="https://wa.me/"]').forEach(link => {
      if (link.id !== 'whatsapp-order-button') link.href = WHATSAPP_BASE; // one source of truth for the number
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    if (dom.whatsappOrder) dom.whatsappOrder.href = buildOrderWhatsAppUrl(null);
  }

  function onWhatsAppOrderClick(link) {
    const order = findOrder(dom.invoice && dom.invoice.dataset.orderId) || findOrder(state.lastOrderId);
    link.href = buildOrderWhatsAppUrl(order); // the link then opens normally — nothing is sent automatically
  }

  function onContactSubmit(event) {
    event.preventDefault();
    const form = dom.contactForm;
    if (!form) return;
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    const get = id => { const el = byId(id); return el ? el.value.trim() : ''; };
    const text = [
      'Hello ShobPaben, I have a message from the website contact form.',
      '',
      'Name: ' + get('contact-name'),
      'Contact: ' + get('contact-method'),
      'Subject: ' + get('contact-subject'),
      'Message: ' + get('contact-message')
    ].join('\n');
    // No backend exists yet, so the message is handed over to WhatsApp for the customer to send.
    window.open(WHATSAPP_BASE + '?text=' + encodeURIComponent(text), '_blank', 'noopener,noreferrer');
    toast.show('The contact form is not connected to a server yet. WhatsApp has opened with your message — press Send there to deliver it.', { duration: 7000 });
  }

  function onAccountLeadSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const consent = byId('account-sheets-consent');
    const status = byId('account-integration-status') || byId('account-notice');
    const say = message => { if (status) status.textContent = message; else toast.show(message, { type: 'error', duration: 7000 }); };
    if (!consent || !consent.checked) { say(activeLanguage === 'bn' ? 'তথ্য পাঠানোর আগে Google Sheets-এ পাঠানোর সম্মতি দিন।' : 'Please consent to Google Sheets recording before submitting.'); return; }
    const name = byId('account-customer-name');
    const email = byId('account-customer-email');
    const phone = byId('account-customer-phone');
    const location = byId('account-customer-location');
    if (!name || !email || !phone || !location || !name.value.trim() || !email.value.trim() || !phone.value.trim() || !location.value.trim()) {
      say(activeLanguage === 'bn' ? 'নাম, ইমেইল, ফোন এবং ডেলিভারি এলাকার সব তথ্য পূরণ করুন।' : 'Enter your name, email, phone number, and delivery area.'); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { say(activeLanguage === 'bn' ? 'একটি বৈধ ইমেইল ঠিকানা লিখুন।' : 'Enter a valid email address.'); return; }
    if (!normalizeBdPhone(phone.value)) { say(activeLanguage === 'bn' ? 'একটি বৈধ বাংলাদেশি মোবাইল নম্বর লিখুন।' : 'Enter a valid Bangladesh mobile number.'); return; }
    // This storefront has no authentication provider and no configured server integration.
    // Never send this data to Google Sheets directly from a browser.
    const dateField = byId('account-event-datetime');
    if (dateField) dateField.value = new Date().toISOString();
    say(GOOGLE_SHEETS_WEB_APP_URL ?
      (activeLanguage === 'bn' ? 'নিরাপদ সার্ভার ইন্টিগ্রেশন কনফিগার না করা পর্যন্ত তথ্য পাঠানো হচ্ছে না।' : 'No data was sent: a secure server-side integration is not configured.') :
      (activeLanguage === 'bn' ? 'Google Sheets সংযোগ ও নিরাপদ লগইন এখনো কনফিগার করা হয়নি। কোনো তথ্য পাঠানো বা লগইন করা হয়নি।' : 'Google Sheets and secure sign-in are not configured. No information was sent and you are not logged in.'));
  }

  function onNewsletterSubmit(event) {
    event.preventDefault();
    // Subscribing needs a backend to store emails. Nothing is saved or sent here.
    toast.show('Newsletter sign-up is not available yet. Your email was not saved.', { duration: 5000 });
  }

  /* ======================================================================
     17. EVENT WIRING (event delegation — one listener per event type)
     ====================================================================== */

  function getQuantityContext(el) {
    if (el.closest('.cart-item')) return 'cart';
    if (el.closest('#quick-view-dialog')) return 'quick';
    if (el.closest('#product-details-page')) return 'detail';
    return '';
  }

  function handleQuantity(el, delta) {
    const context = getQuantityContext(el);
    if (context === 'cart') {
      const row = el.closest('.cart-item');
      changeLineQty(row.dataset.lineKey, delta);
    } else if (context === 'detail') {
      state.detail.qty += delta;
      updateQuantityUi('detail');
    } else if (context === 'quick') {
      state.quickView.qty += delta;
      updateQuantityUi('quick');
    }
  }

  function handleAddToCart(el) {
    const productId = el.dataset.productId || '';
    const p = PUBLIC_BY_ID.get(productId);
    if (!p) { toast.show('This product is not available.', { type: 'error' }); return; }

    const onDetail = el.id === 'detail-add-to-cart';
    const onQuick = el.id === 'quick-view-add-to-cart';
    if (p.variants.length && !onDetail) {
      // Options must be chosen on the product page.
      closeQuickView();
      navigate(productPath(p.id));
      toast.show('Please choose your options, then add to cart.');
      return;
    }
    if (onDetail) { addToCart(p.id, state.detail.qty, state.detail.selections); }
    else if (onQuick) { if (addToCart(p.id, state.quickView.qty, null)) closeQuickView(); }
    else { addToCart(p.id, 1, null); }
  }

  function handleBuyNow(el) {
    const p = PUBLIC_BY_ID.get(el.dataset.productId || '');
    if (!p) return;
    if (addToCart(p.id, state.detail.qty, state.detail.selections)) navigate('checkout');
  }

  function onDocumentClick(event) {
    // Outside-click handling
    if (dom.suggestions && !dom.suggestions.hidden && !event.target.closest('#product-search-form')) hideSuggestions();
    if (dom.menu && !dom.menu.hidden && !event.target.closest('#main-navigation-menu') && !event.target.closest('#hamburger-button')) closeMenu(false);
    if (dom.quickView && event.target === dom.quickView) {
      const r = dom.quickView.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeQuickView();
    }

    const el = event.target.closest('[data-action]');
    if (!el) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const action = el.dataset.action;
    const insideMenu = !!el.closest('#main-navigation-menu');

    switch (action) {
      case 'close-announcement':
        setHidden(dom.announcementBar, true);
        try { window.sessionStorage.setItem(KEYS.announcementClosed, '1'); } catch (e) { /* ignore */ }
        break;
      case 'open-category': openCategory(el.dataset.category); break;
      case 'open-page': openPageFromLink(el); break;
      case 'open-cart': navigate('cart'); break;
      case 'continue-shopping': continueShopping(el); break;
      case 'open-menu': openMenu(); break;
      case 'close-menu': closeMenu(true); break;
      case 'carousel-prev': carousel.prev(); break;
      case 'carousel-next': carousel.next(); break;
      case 'carousel-goto': carousel.goTo(Number(el.dataset.slideIndex)); break;
      case 'open-product':
        if (!el.dataset.productId) return;
        closeQuickView();
        navigate(productPath(el.dataset.productId));
        break;
      case 'open-quick-view': openQuickView(el.dataset.productId); break;
      case 'close-quick-view': closeQuickView(); break;
      case 'select-thumbnail': selectThumbnail(el); break;
      case 'add-to-cart': handleAddToCart(el); break;
      case 'buy-now': handleBuyNow(el); break;
      case 'add-to-wishlist': toggleWishlist(el.dataset.productId); break;
      case 'quantity-minus': handleQuantity(el, -1); break;
      case 'quantity-plus': handleQuantity(el, 1); break;
      case 'remove-cart-item': {
        const row = el.closest('.cart-item');
        if (row) removeLine(row.dataset.lineKey);
        break;
      }
      case 'apply-coupon': applyCoupon(); break;
      case 'checkout':
        if (!state.cart.lines.length) { toast.show('Your cart is empty.', { type: 'error' }); }
        else navigate('checkout');
        break;
      case 'clear-filters': clearFilters(); break;
      case 'load-more': loadMore(); break;
      case 'clear-search': clearSearch(); break;
      case 'print-invoice': printInvoice(); break;
      case 'close-invoice-popup': closeInvoicePopup(); break;
      case 'whatsapp-order': onWhatsAppOrderClick(el); return; // let the link open normally
      // Submit buttons are handled by their form's submit event; do not block them.
      case 'search-submit': case 'place-order': case 'submit-contact': case 'subscribe-newsletter': return;
      default: return;
    }
    event.preventDefault();
    if (insideMenu && action !== 'open-menu' && action !== 'close-menu') closeMenu(false);
  }

  function onSubmit(event) {
    const form = event.target;
    if (!form || !form.id) return;
    switch (form.id) {
      case 'product-search-form': event.preventDefault(); runSearch(dom.searchInput ? dom.searchInput.value : ''); break;
      case 'category-filters-form': event.preventDefault(); break;
      case 'checkout-form': onCheckoutSubmit(event); break;
      case 'contact-form': onContactSubmit(event); break;
      case 'newsletter-form': onNewsletterSubmit(event); break;
      case 'account-profile-form': onAccountLeadSubmit(event); break;
      default: break;
    }
  }

  const refreshListingDebounced = debounce(refreshListing, 160);

  function onInput(event) {
    const t = event.target;
    if (t === dom.filterMinRange || t === dom.filterMaxRange) {
      syncPriceControls(t === dom.filterMinRange ? 'min-range' : 'max-range');
      refreshListingDebounced();
      return;
    }
    if (t === dom.filterMin || t === dom.filterMax) {
      syncPriceControls(t === dom.filterMin ? 'min-input' : 'max-input');
      refreshListingDebounced();
      return;
    }
    if (t.closest && t.closest('#category-filters-form') && (t.type === 'search' || t.type === 'number' || t.type === 'text')) {
      refreshListingDebounced();
    }
    if (t.closest && t.closest('#checkout-form') && t.id) setFieldError(t, '');
  }

  function onChange(event) {
    const t = event.target;
    if (!t.closest) return;
    if (t.closest('#category-filters-form') && t.tagName === 'SELECT') refreshListing();
    if (t === dom.filterMinRange || t === dom.filterMaxRange || t === dom.filterMin || t === dom.filterMax) {
      syncPriceControls(t === dom.filterMinRange ? 'min-range' : t === dom.filterMaxRange ? 'max-range' : t === dom.filterMin ? 'min-input' : 'max-input');
      refreshListing();
    }
    if (t === dom.languageSelector) setLanguage(t.value, true);
    if (t.closest('#checkout-form')) {
      if (t.id) setFieldError(t, '');
      if (t.id === 'customer-division') { populateDistricts(t.value); renderCheckoutSummary(); }
      if (t.id === 'customer-district') renderCheckoutSummary();
    }
    if (t.dataset && t.dataset.variantName && t.closest('#detail-variants')) {
      state.detail.selections[t.dataset.variantName] = t.value;
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      if (dom.menu && !dom.menu.hidden) { closeMenu(true); return; }
      if (dom.suggestions && !dom.suggestions.hidden) hideSuggestions();
    }
    trapMenuFocus(event);
  }

  function onStorageEvent(event) {
    if (event.key === KEYS.cart) { state.cart = loadCart().cart; syncCartUi(); }
    else if (event.key === KEYS.wishlist) {
      state.wishlist = loadWishlist();
      syncAllWishlistButtons();
      if (state.route.name === 'wishlist') renderWishlistPage();
    } else if (event.key === KEYS.orders) {
      state.orders = loadOrders();
      if (state.route.name === 'orders') renderOrderHistory();
    } else if (event.key === KEYS.language) {
      let storedLanguage = 'en';
      try { storedLanguage = JSON.parse(event.newValue || '"en"'); } catch (e) { storedLanguage = 'en'; }
      activeLanguage = storedLanguage === 'bn' ? 'bn' : 'en';
      applyStaticLanguage();
      rerenderForLanguage();
    }
  }

  function bindEvents() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('hashchange', () => renderRoute(true));
    window.addEventListener('storage', onStorageEvent);

    if (dom.quickView) {
      dom.quickView.addEventListener('close', () => { state.quickView.productId = ''; });
    }
  }

  /* ======================================================================
     18. INITIALISATION
     ====================================================================== */

  function applyStaticSettings() {
    // Announcement bar
    if (dom.announcementBar) {
      let closed = false;
      try { closed = window.sessionStorage.getItem(KEYS.announcementClosed) === '1'; } catch (e) { /* ignore */ }
      if (!CONFIG.announcement.enabled || closed) dom.announcementBar.hidden = true;
      else if (CONFIG.announcement.message && dom.announcementMessage) dom.announcementMessage.textContent = CONFIG.announcement.message;
    }
    // Footer year
    const year = $('[data-current-year]');
    if (year) year.textContent = String(new Date().getFullYear());
    // Menu button should start collapsed
    if (dom.hamburger) dom.hamburger.setAttribute('aria-expanded', 'false');
  }

  function init() {
    cacheDom();
    buildCatalogue();
    if (dom.languageSelector) {
      const savedLanguage = storage.read(KEYS.language, 'en');
      activeLanguage = savedLanguage === 'bn' ? 'bn' : 'en';
      dom.languageSelector.value = activeLanguage;
    }
    syncPriceControls('init');
    setupImageFallbacks();
    applyStaticSettings();
    setupWhatsAppLinks();

    // Restore saved data (validated against the current catalogue)
    state.wishlist = loadWishlist();
    state.orders = loadOrders();
    state.pendingOrder = loadPendingOrder();
    if (state.pendingOrder) state.lastOrderId = state.pendingOrder.id;
    const loaded = loadCart();
    state.cart = loaded.cart;

    renderHome();
    initFlashTimer();
    setupSearch();
    bindEvents();
    populateDistricts('');
    syncCartUi();
    renderRoute(false);
    applyStaticLanguage();
    syncPriceControls('init');
    setupPriceSliderPointerDragging();
    // Initialize autoplay after route visibility and language state are established.
    carousel.init();

    if (loaded.dropped > 0) {
      toast.show('Some items in your saved cart are no longer available and were removed.');
    }
    if (!storage.available) console.warn('[ShobPaben] localStorage is not available. The cart and wishlist will not be saved between visits.');

    // Small public hook (e.g. for a future "Quick View" button: data-action="open-quick-view" data-product-id="…").
    window.ShobPaben = Object.freeze({ openQuickView: openQuickView });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();