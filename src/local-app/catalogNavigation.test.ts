import {expect,it} from 'vitest';
import {readCatalogNavigation,catalogNavigationUrl} from './catalogNavigation';
it('opens legacy episode links and discards unsupported locations and malformed paging',()=>{
 const legacy=readCatalogNavigation('?episode=episode-one');expect(legacy.view).toBe('episodes');expect(legacy.episode).toBe('episode-one');
 const invalid=readCatalogNavigation('?view=secrets&episode=../../other&step=approve&tab=credentials&page=-1&pendingPage=99999999&visibility=hidden&status=approved&sort=unsafe');expect(invalid).toMatchObject({view:'operations',episode:'',step:null,tab:'visual',filters:{page:1,pendingPage:1,visibility:'active',status:'all',sort:'updated'}});
});
it('keeps independently known list, workspace and read-only history positions in a shareable URL',()=>{
 const value=readCatalogNavigation('?view=episodes&accountId=account-one&seriesId=series-one&q=山&status=blocked&page=3&episode=episode-one&step=preparation&tab=voice&historyTab=sources&historyPage=2');
 const url=catalogNavigationUrl(value,'http://localhost/workspace?unrelated=yes#main');expect(url).toBe('/workspace?unrelated=yes&view=episodes&episode=episode-one&step=preparation&tab=voice&page=3&accountId=account-one&seriesId=series-one&q=%E5%B1%B1&status=blocked&historyTab=sources&historyPage=2#main');
});
