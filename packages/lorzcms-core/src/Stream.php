<?php
declare(strict_types=1);
namespace SiteCms;

final class Stream {
    /** Keep generated feeds reliable on the Windows development server as well. */
    public static function text(string $body):void {
        if(($_SERVER['REQUEST_METHOD'] ?? 'GET')==='HEAD'){return;}
        for($offset=0,$length=strlen($body);$offset<$length;$offset+=8192){
            echo substr($body,$offset,8192);if(ob_get_level()>0){ob_flush();}flush();
            if(PHP_SAPI==='cli-server' && PHP_OS_FAMILY==='Windows'){usleep(1000);}
        }
    }
    /** Stream binary downloads in bounded chunks instead of buffering the entire file. */
    public static function file(string $path):void {
        if(($_SERVER['REQUEST_METHOD'] ?? 'GET')==='HEAD'){return;}
        $handle=fopen($path,'rb');if(!$handle){throw new HttpError(500,'Datei konnte nicht geöffnet werden.');}
        try {
            while(!feof($handle)){
                $chunk=fread($handle,8192);if($chunk===false){throw new HttpError(500,'Datei konnte nicht gelesen werden.');}
                echo $chunk;if(ob_get_level()>0){ob_flush();}flush();
                // The Windows development server can exhaust its socket send buffer during bursts.
                if(PHP_SAPI==='cli-server' && PHP_OS_FAMILY==='Windows'){usleep(1000);}
            }
        }finally{fclose($handle);}
    }
}
