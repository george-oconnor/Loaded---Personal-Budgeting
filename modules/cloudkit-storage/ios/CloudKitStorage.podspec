Pod::Spec.new do |s|
  s.name           = 'CloudKitStorage'
  s.version        = '1.0.0'
  s.summary        = 'Thin CloudKit CRUD bridge for private and public databases'
  s.description    = 'Exposes CKDatabase record operations (save, delete, fetch, query with cursors) and account/zone management to JavaScript.'
  s.homepage       = 'https://github.com/george-oconnor/Loaded---Personal-Budgeting'
  s.license        = 'MIT'
  s.author         = 'George OConnor'
  s.platform       = :ios, '15.1'
  s.source         = { git: '' }
  s.source_files   = '**/*.swift'
  s.frameworks     = 'CloudKit'

  s.dependency 'ExpoModulesCore'
end
