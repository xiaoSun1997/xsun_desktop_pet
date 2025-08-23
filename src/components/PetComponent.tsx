import { useState } from "react";
import "./PetComponent.css";

const actions = [
    { name: "move", src: "/pet/move.gif" },
    { name: "relax", src: "/pet/relax.gif" },
    { name: "sit", src: "/pet/sit.gif" },
    { name: "jump", src: "/pet/sleep.gif" },
];

export default function PetComponent() {
    const [index, setIndex] = useState(0);

    const handleClick = () => {
        setIndex((prev) => (prev + 1) % actions.length);
    };

    return (
        <div className="pet-container" onClick={handleClick}>
            <img
                src={actions[index].src}
                alt={actions[index].name}
                className="pet-image"
            />
        </div>
    );
}
