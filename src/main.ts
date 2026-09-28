
function checkOvertaking(currentCar, nextCar) {
    // Logic to check if overtaking is possible
    if (overtakingPossible(currentCar, nextCar)) {
        // Code to handle overtaking
        console.log('Overtaking was possible, proceeding...');
    } else {
        // Code to handle waiting
        console.log('Overtaking was not possible, waiting...');
    }
}
