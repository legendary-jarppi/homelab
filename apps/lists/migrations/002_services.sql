-- Services in the spelling of the service select (SERVICES in src/lib/domain.ts). Values that are
-- clearly one of those services ("Amazon Prime", "prime", "Disney", "Yle areena") take its name;
-- anything else stays as typed.
UPDATE items SET service = CASE lower(regexp_replace(btrim(service), '\s+', ' ', 'g'))
		WHEN 'netflix' THEN 'Netflix'
		WHEN 'prime' THEN 'Prime Video'
		WHEN 'prime video' THEN 'Prime Video'
		WHEN 'amazon' THEN 'Prime Video'
		WHEN 'amazon prime' THEN 'Prime Video'
		WHEN 'amazon prime video' THEN 'Prime Video'
		WHEN 'disney' THEN 'Disney+'
		WHEN 'disney+' THEN 'Disney+'
		WHEN 'disney plus' THEN 'Disney+'
		WHEN 'areena' THEN 'Yle Areena'
		WHEN 'yle areena' THEN 'Yle Areena'
		WHEN 'hbo' THEN 'HBO Max'
		WHEN 'hbo max' THEN 'HBO Max'
		WHEN 'max' THEN 'HBO Max'
		WHEN 'apple tv' THEN 'Apple TV+'
		WHEN 'apple tv+' THEN 'Apple TV+'
		WHEN 'viaplay' THEN 'Viaplay'
		WHEN 'katsomo' THEN 'MTV Katsomo'
		WHEN 'mtv katsomo' THEN 'MTV Katsomo'
		WHEN 'ruutu' THEN 'Ruutu'
		WHEN 'skyshowtime' THEN 'SkyShowtime'
		WHEN 'elisa viihde' THEN 'Elisa Viihde'
		ELSE service
	END
WHERE service IS NOT NULL;
