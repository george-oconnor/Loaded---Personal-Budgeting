Pod::Spec.new do |s|
  s.name           = 'PdfTextExtractor'
  s.version        = '1.0.0'
  s.summary        = 'On-device PDF text extraction using Apple PDFKit and Vision'
  s.description    = 'Extracts text from PDF bank statements entirely on-device using Apple frameworks. No data leaves the device.'
  s.homepage       = 'https://github.com/george-oconnor/Loaded---Personal-Budgeting'
  s.license        = 'MIT'
  s.author         = 'George OConnor'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.source_files   = '**/*.swift'
  s.frameworks     = 'PDFKit', 'Vision'

  s.dependency 'ExpoModulesCore'
end
