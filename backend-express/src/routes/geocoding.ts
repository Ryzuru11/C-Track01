import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAnyPermission, requireWeb } from '../middleware/permissions';
import { isGoogleMapsShortLink } from '../utils/googleMaps';

const router = Router();

// Used by the Task page map (create/edit task location)
router.use(authenticate, requireWeb, requireAnyPermission('tasks.create', 'tasks.update'));

// Proxy untuk search address
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q as string)}&format=json&limit=5`;
    
    console.log('Nominatim search request:', nominatimUrl);
    
    const response = await fetch(nominatimUrl, {
      headers: { 
        'Accept-Language': 'id',
        'User-Agent': 'CTrackApp'
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim API returned ${response.status}`);
    }

    const data = await response.json();
    console.log('Nominatim search result count:', (data as any[]).length);
    
    res.json(data);
  } catch (error) {
    console.error('Geocoding search error:', error);
    res.status(500).json({ error: 'Failed to search address', message: (error as Error).message });
  }
});

// Proxy untuk reverse geocoding
router.get('/reverse', async (req: Request, res: Response) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon parameters required' });
    }

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    
    console.log('Nominatim reverse geocoding request:', nominatimUrl);
    
    const response = await fetch(nominatimUrl, {
      headers: { 
        'Accept-Language': 'id',
        'User-Agent': 'CTrackApp'
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim API returned ${response.status}`);
    }

    const data = await response.json();
    console.log('Nominatim reverse result:', (data as any).display_name);
    
    res.json(data);
  } catch (error) {
    console.error('Geocoding reverse error:', error);
    res.status(500).json({ error: 'Failed to reverse geocode', message: (error as Error).message });
  }
});

/**
 * Extract coordinates from Google Maps link
 * Supports multiple URL formats: @lat,lng, !3d!4d, query=, center=, ll=
 * Handles both standard and shortened URLs (maps.app.goo.gl)
 */
router.post('/extract-from-maps', async (req: Request, res: Response) => {
  try {
    const { mapsLink } = req.body;
    
    if (!mapsLink || typeof mapsLink !== 'string') {
      return res.status(400).json({ 
        error: 'mapsLink is required and must be a string',
        received: typeof mapsLink
      });
    }

    console.log('🔗 [EXTRACT] Input link:', mapsLink);

    /**
     * Extract coordinates from URL using multiple regex patterns
     * Returns { latitude: number, longitude: number } or null
     */
    const extractCoordinates = (url: string): { latitude: number; longitude: number } | null => {
      // Decode URL-encoded characters (%2C, %40, etc.)
      const decodedUrl = decodeURIComponent(url);
      console.log('📝 Decoded URL:', decodedUrl);
      
      // Comprehensive regex patterns for different Google Maps URL formats
      const patterns = [
        // Format 1: @-7.8228957,110.3912603 (most common format)
        { 
          regex: /@(-?\d+\.\d+),(-?\d+\.\d+)/, 
          name: '@lat,lng decimals',
          order: 'lat,lng'
        },
        // Format 2: @-7,110 (integer coordinates)
        { 
          regex: /@(-?\d+),(-?\d+)(?![.\d])/, 
          name: '@lat,lng integers',
          order: 'lat,lng'
        },
        // Format 3: !3d-7.8228957!4d110.3912603 (alternative encoding)
        { 
          regex: /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/, 
          name: '!3d!4d format',
          order: 'lat,lng'
        },
        // Format 4: query=-7.8228957,110.3912603
        { 
          regex: /[?&]query=(-?\d+\.?\d*),(-?\d+\.?\d*)/, 
          name: 'query= format',
          order: 'lat,lng'
        },
        // Format 5: center=-7.8228957,110.3912603
        { 
          regex: /center=(-?\d+\.?\d*),(-?\d+\.?\d*)/, 
          name: 'center= format',
          order: 'lat,lng'
        },
        // Format 6: ll=-7.8228957,110.3912603 (latitude-longitude shorthand)
        { 
          regex: /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/, 
          name: 'll= format',
          order: 'lat,lng'
        },
        // Format 7: /@-7.8228957,110.3912603,15z (with zoom level)
        { 
          regex: /@(-?\d+\.?\d*),(-?\d+\.?\d*),\d+\.?\d*z/, 
          name: '@lat,lng,zoom',
          order: 'lat,lng'
        },
      ];

      // Try each pattern sequentially
      for (let i = 0; i < patterns.length; i++) {
        const { regex, name, order } = patterns[i];
        console.log(`🔍 [${i + 1}/${patterns.length}] Testing: ${name}`);
        
        const match = decodedUrl.match(regex);
        
        if (match && match[1] && match[2]) {
          console.log(`🎯 MATCH! Pattern: "${name}"`);
          console.log(`   Captured groups: ["${match[1]}", "${match[2]}"]`);
          
          const latitude = parseFloat(match[1]);
          const longitude = parseFloat(match[2]);
          
          // Validate parsed numbers
          if (isNaN(latitude) || isNaN(longitude)) {
            console.warn(`⚠️ NaN detected: lat=${latitude}, lng=${longitude}`);
            continue; // Try next pattern
          }
          
          // Validate coordinate bounds (global validity)
          if (latitude < -90 || latitude > 90) {
            console.warn(`⚠️ Invalid latitude: ${latitude} (must be -90 to 90)`);
            continue;
          }
          if (longitude < -180 || longitude > 180) {
            console.warn(`⚠️ Invalid longitude: ${longitude} (must be -180 to 180)`);
            continue;
          }
          
          console.log(`✅ Valid coordinates extracted!`);
          console.log(`   Latitude:  ${latitude}`);
          console.log(`   Longitude: ${longitude}`);
          
          return { latitude, longitude };
        }
      }
      
      console.error('❌ No regex pattern matched the URL');
      console.log('💡 Tip: Check if URL contains coordinate data like @-7.82,110.39');
      return null;
    };

    // Step 1: Try extracting directly from the provided link
    let result = extractCoordinates(mapsLink);
    
    if (result) {
      console.log('✅ Success on first attempt');
      return res.json(result);
    }

    // Step 2: If extraction failed and it's a shortened URL, resolve redirect first
    if (isGoogleMapsShortLink(mapsLink)) {
      console.log('🔄 Detected short URL - resolving redirect...');
      
      try {
        const redirectResponse = await fetch(mapsLink, {
          redirect: 'follow',
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
          }
        });

        const finalUrl = redirectResponse.url;
        console.log('✅ Resolved to:', finalUrl);

        // Try extraction again with resolved URL
        result = extractCoordinates(finalUrl);
        
        if (result) {
          console.log('✅ Success after resolving short URL');
          return res.json(result);
        }
      } catch (redirectError: any) {
        console.error('⚠️ Short URL resolution failed:', redirectError.message);
        return res.status(400).json({ 
          error: 'Gagal resolve short URL', 
          message: 'Gunakan link Google Maps lengkap atau coba lagi',
          details: redirectError.message
        });
      }
    }

    // Step 3: If still no match, return detailed error
    console.error('❌ FAILED: Could not extract coordinates');
    return res.status(400).json({ 
      error: 'Tidak dapat menemukan koordinat dalam link',
      message: 'Format link Google Maps tidak dikenali. Pastikan link berisi koordinat.',
      supportedFormats: [
        'https://maps.google.com/@-7.8228957,110.3912603,15z',
        'https://maps.google.com/maps?q=-7.8228957,110.3912603',
        'https://www.google.com/maps/place/Name/@-7.8228957,110.3912603',
        'https://maps.app.goo.gl/xxx (short link)'
      ],
      receivedLink: mapsLink.substring(0, 100) + (mapsLink.length > 100 ? '...' : '')
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Server error saat ekstraksi koordinat', 
      message: (error as Error).message 
    });
  }
});

/**
 * BACKWARD COMPATIBILITY ALIAS
 * Old frontend versions call this endpoint, redirect to /extract-from-maps logic
 */
router.post('/extract-coordinates', async (req: Request, res: Response) => {
  console.log('⚠️ [DEPRECATED] /extract-coordinates called - use /extract-from-maps instead');
  
  // Forward to the main handler by reusing the extraction logic
  try {
    const { mapsLink } = req.body;
    
    if (!mapsLink || typeof mapsLink !== 'string') {
      return res.status(400).json({ 
        error: 'mapsLink is required and must be a string',
        received: typeof mapsLink
      });
    }

    console.log('🔗 [EXTRACT-LEGACY] Input link:', mapsLink);

    const extractCoordinates = (url: string): { latitude: number; longitude: number } | null => {
      const decodedUrl = decodeURIComponent(url);
      console.log('📝 Decoded URL:', decodedUrl);
      
      const patterns = [
        { regex: /@(-?\d+\.\d+),(-?\d+\.\d+)/, name: '@lat,lng decimals' },
        { regex: /@(-?\d+),(-?\d+)(?![.\d])/, name: '@lat,lng integers' },
        { regex: /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/, name: '!3d!4d format' },
        { regex: /[?&]query=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'query= format' },
        { regex: /center=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'center= format' },
        { regex: /[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/, name: 'll= format' },
        { regex: /@(-?\d+\.?\d*),(-?\d+\.?\d*),\d+\.?\d*z/, name: '@lat,lng,zoom' },
      ];

      for (let i = 0; i < patterns.length; i++) {
        const { regex, name } = patterns[i];
        console.log(`🔍 [${i + 1}/${patterns.length}] Testing: ${name}`);
        
        const match = decodedUrl.match(regex);
        
        if (match && match[1] && match[2]) {
          console.log(`🎯 MATCH! Pattern: "${name}"`);
          
          const latitude = parseFloat(match[1]);
          const longitude = parseFloat(match[2]);
          
          if (isNaN(latitude) || isNaN(longitude)) {
            console.warn(`⚠️ NaN detected: lat=${latitude}, lng=${longitude}`);
            continue;
          }
          
          if (latitude < -90 || latitude > 90) {
            console.warn(`⚠️ Invalid latitude: ${latitude}`);
            continue;
          }
          if (longitude < -180 || longitude > 180) {
            console.warn(`⚠️ Invalid longitude: ${longitude}`);
            continue;
          }
          
          console.log(`✅ Valid coordinates: lat=${latitude}, lng=${longitude}`);
          return { latitude, longitude };
        }
      }
      
      console.error('❌ No pattern matched');
      return null;
    };

    let result = extractCoordinates(mapsLink);
    
    if (result) {
      console.log('✅ Success');
      return res.json(result);
    }

    if (isGoogleMapsShortLink(mapsLink)) {
      console.log('🔄 Resolving short URL...');
      
      try {
        const redirectResponse = await fetch(mapsLink, {
          redirect: 'follow',
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          }
        });

        const finalUrl = redirectResponse.url;
        console.log('✅ Resolved to:', finalUrl);

        result = extractCoordinates(finalUrl);
        
        if (result) {
          return res.json(result);
        }
      } catch (redirectError: any) {
        console.error('⚠️ Short URL resolution failed:', redirectError.message);
        return res.status(400).json({ 
          error: 'Gagal resolve short URL', 
          message: redirectError.message
        });
      }
    }

    console.error('❌ FAILED: Could not extract coordinates');
    return res.status(400).json({ 
      error: 'Tidak dapat menemukan koordinat dalam link',
      message: 'Format link Google Maps tidak dikenali'
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Server error saat ekstraksi koordinat', 
      message: (error as Error).message 
    });
  }
});

export default router;
