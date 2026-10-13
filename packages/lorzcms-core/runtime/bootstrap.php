<?php
declare(strict_types=1);
if (PHP_VERSION_ID < 80300) { throw new RuntimeException('PHP 8.3 oder neuer erforderlich.'); }
spl_autoload_register(static function(string $class): void {
    $paths = ['SiteCms\\' => LORZCMS_CORE.'/src/', 'Hsg\\' => LORZCMS_ROOT.'/projects/hsg/src/'];
    foreach ($paths as $prefix => $root) {
        if (str_starts_with($class, $prefix)) {
            $file = $root.str_replace('\\', '/', substr($class, strlen($prefix))).'.php';
            if (is_file($file)) { require $file; }
        }
    }
});
function cms_config(): array {
    return array_replace([
        'project' => 'base', 'dsn' => 'sqlite:'.LORZCMS_ROOT.'/var/cms.sqlite',
        'db_user' => null, 'db_password' => null, 'storage' => LORZCMS_ROOT.'/var',
        'environment' => 'production', 'base_url' => '',
    ], is_file(LORZCMS_ROOT.'/config/local.php') ? require LORZCMS_ROOT.'/config/local.php' : []);
}
function cms_boot(?array $configuration = null): array {
    $configuration ??= cms_config();
    $project = $configuration['project'];
    if (!preg_match('/^[a-z][a-z0-9-]*$/D', $project)) { throw new RuntimeException('Unbekanntes Projekt.'); }
    $projectFile = LORZCMS_ROOT.'/projects/'.$project.'/project.php';
    if (!is_file($projectFile)) { throw new RuntimeException('Projekt fehlt.'); }
    if (!is_dir($configuration['storage'])) { mkdir($configuration['storage'], 0700, true); }
    $definition = require $projectFile;
    $store = new SiteCms\Store($configuration['dsn'], $configuration['db_user'], $configuration['db_password']);
    $schema = new SiteCms\Schema($definition['types']);
    $access = new SiteCms\Access($store, $definition['roles']);
    $site = new SiteCms\Site($store, $access, $definition);
    $content = new SiteCms\Content($store, $schema, $access, $site);
    return [$configuration, $definition, $store, $schema, $access, $content];
}
