<?php
declare(strict_types=1);
return '<article class="landing-body">'.($view['intro']!==''?'<div class="landing-intro site-container">'.$view['intro'].'</div>':'').'<div class="site-container page-content">'.$view['content'].'</div></article>';
