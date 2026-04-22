import React from "react";
import { Search } from "lucide-react";
import { Input } from "../ui";
import { useSkillContext } from "../../contexts";

const SearchBar: React.FC = React.memo(() => {
   const { searchQuery, setSearchQuery } = useSkillContext();

   return (
      <div className="px-3 py-2 border-b border-border">
         <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <Input
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
               placeholder="Search skills..."
               className="h-7 pl-7 text-xs"
            />
         </div>
      </div>
   );
});
SearchBar.displayName = "SearchBar";
export default SearchBar;
