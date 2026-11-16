import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
 return { name:"Etihad Traders", short_name:"Etihad", description:"Etihad Traders business management", start_url:"/", scope:"/", display:"standalone", orientation:"any", background_color:"#101d35", theme_color:"#101d35", icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}] };
}
